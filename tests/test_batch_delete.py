"""批量删除账号接口的回归测试。

覆盖点（都是这个接口最容易出错的地方）：

  * 只删选中的，别的一个不动；
  * 已绑定 API Key 的账号被跳过，且**不影响同一批里其它账号**被删；
  * 不存在 / 已删的 id 如实回报，不吞掉；
  * 空列表、超上限直接 400，而不是「静默删 0 条」；
  * 重复 id 只算一次（前端重复提交不该重复计数）；
  * 账号的冷却记录随账号一起清掉，不留孤儿行。
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

# 必须**早于** `admin.*` 导入：`admin/db.py` 在模块级就按 settings 建引擎，
# 默认值是 MySQL。这里固定成 SQLite 文件库 —— 不能用 `:memory:`，
# 因为内存库走 SingletonThreadPool，不接受 admin/db.py 传的 pool_timeout /
# max_overflow，模块导入阶段就会 TypeError。
os.environ.setdefault(
    "ADMIN_DATABASE_URL",
    "sqlite:///" + str(Path(tempfile.gettempdir()) / "miraihub_test_batch_delete.db"),
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from admin.db import Base
from admin.models import Account, AccountModelCooldown, ApiKey
from admin.routers.accounts import (
    _BULK_DELETE_LIMIT,
    BatchDeleteIn,
    batch_delete_accounts,
)


class BatchDeleteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    # ---- 造数据 -------------------------------------------------------
    def _account(self, uid: str, platform: str = "workbuddy") -> Account:
        acc = Account(uid=uid, name=uid, platform=platform,
                      auth_json="{}", status="active", balance_remain=10)
        self.db.add(acc)
        self.db.commit()
        return acc

    def _bind_key(self, account_id: int) -> ApiKey:
        key = ApiKey(name="k", key_hash="h-%s" % account_id,
                     account_id=account_id, status="active")
        self.db.add(key)
        self.db.commit()
        return key

    def _call(self, ids):
        return batch_delete_accounts(BatchDeleteIn(ids=ids), _=True, db=self.db)

    def _ids(self):
        return sorted(a.id for a in self.db.query(Account).all())

    # ---- 用例 ---------------------------------------------------------
    def test_deletes_only_selected(self):
        """勾了 2 个，就只删这 2 个。"""
        a, b, c = (self._account(u) for u in ("a", "b", "c"))
        keep = c.id

        result = self._call([a.id, b.id])

        self.assertTrue(result["ok"])
        self.assertEqual(result["deleted"], 2)
        self.assertEqual(result["missing"], [])
        self.assertEqual(result["blocked"], [])
        self.assertEqual(self._ids(), [keep])

    def test_skips_accounts_bound_to_api_key(self):
        """绑了 Key 的跳过，同批其它账号照删。"""
        a, b = self._account("a"), self._account("b")
        self._bind_key(a.id)

        result = self._call([a.id, b.id])

        self.assertFalse(result["ok"])          # 有跳过就不是「全成功」
        self.assertEqual(result["deleted"], 1)
        self.assertEqual([item["id"] for item in result["blocked"]], [a.id])
        # 被挡下的必须还在
        self.assertEqual(self._ids(), [a.id])

    def test_reports_missing_ids(self):
        """不存在的 id 单独回报，不混进 deleted。"""
        a = self._account("a")

        result = self._call([a.id, 999999])

        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["missing"], [999999])
        self.assertFalse(result["ok"])
        self.assertEqual(self._ids(), [])

    def test_rejects_empty_selection(self):
        """空列表 400 —— 不能悄悄返回「删了 0 个」。"""
        with self.assertRaises(HTTPException) as ctx:
            self._call([])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_rejects_over_limit(self):
        """超过单次上限 400，避免一次锁库太久。"""
        with self.assertRaises(HTTPException) as ctx:
            self._call(list(range(1, _BULK_DELETE_LIMIT + 2)))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn(str(_BULK_DELETE_LIMIT), str(ctx.exception.detail))

    def test_deduplicates_repeated_ids(self):
        """同一个 id 传两次只算一次。"""
        a = self._account("a")

        result = self._call([a.id, a.id, a.id])

        self.assertEqual(result["requested"], 1)
        self.assertEqual(result["deleted"], 1)
        self.assertTrue(result["ok"])

    def test_clears_cooldowns_of_deleted_accounts(self):
        """账号删了，它的模型冷却记录不能留下。"""
        a, b = self._account("a"), self._account("b")
        self.db.add_all([
            AccountModelCooldown(account_id=a.id, model="m1"),
            AccountModelCooldown(account_id=b.id, model="m1"),
        ])
        self.db.commit()

        self._call([a.id])

        left = {row.account_id for row in
                self.db.query(AccountModelCooldown).all()}
        self.assertEqual(left, {b.id})

    def test_cross_platform_ids_are_allowed(self):
        """按主键删除，不按平台过滤 —— 跨平台勾选也能一次删掉。"""
        wb = self._account("wb", platform="workbuddy")
        lo = self._account("lo", platform="loomy")

        result = self._call([wb.id, lo.id])

        self.assertEqual(result["deleted"], 2)
        self.assertEqual(self._ids(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
