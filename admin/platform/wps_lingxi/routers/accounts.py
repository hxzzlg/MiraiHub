"""WPS 灵犀管理接口：`/api/wps-lingxi/*`。

    GET  /api/wps-lingxi/meta               平台元信息
    GET  /api/wps-lingxi/scan               扫描本机灵犀客户端登录态（不含 Cookie）
    POST /api/wps-lingxi/import             导入单条（Cookie 或裸 sid）
    POST /api/wps-lingxi/import-batch       批量导入（数组 / JSON 文本 / JSONL）
    POST /api/wps-lingxi/import-local       导入本机客户端账号
    POST /api/wps-lingxi/keepalive          全量探活 + 同步智点
    GET  /api/wps-lingxi/accounts           账号列表
    POST /api/wps-lingxi/accounts/{id}/refresh  重新校验 Cookie + 刷余额
    POST /api/wps-lingxi/accounts/{id}/health   分段健康检查
    POST /api/wps-lingxi/checkin            签到
    GET  /api/wps-lingxi/export             导出（默认脱敏，`reveal=1` 给完整 Cookie）
    GET  /api/wps-lingxi/usage              用量
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from admin.db import get_db
from admin.platform.wps_lingxi.core import endpoints
from admin.platform.wps_lingxi.services import accounts as lingxi_accounts
from admin.platform.wps_lingxi.services import checkin as lingxi_checkin
from admin.security import require_admin

logger = logging.getLogger("admin.platform.wps_lingxi.routers")
router = APIRouter(prefix="/api/wps-lingxi", tags=["wps-lingxi"])

REALM_KEYS = ("cn",)


def _realm_or_400(realm: str) -> str:
    value = (realm or "").strip().lower()
    if value and value not in REALM_KEYS:
        raise HTTPException(400, detail="realm 必须是 cn")
    return value


@router.get("/meta")
def meta(_: bool = Depends(require_admin)):
    return {
        "platform": endpoints.PUBLIC,
        "label": "WPS 灵犀",
        "regions": [{"key": "cn", "label": "WPS 灵犀",
                     "base_url": endpoints.base_of()}],
        "auth": "Cookie: wps_sid=<sid>（可带 uid / copilot_server_branch）",
        "quota_kind": "balance",
        "quota_unit": "credits",
        "note": "WPS 灵犀桌面客户端通路：cowork 会话 → credits run → agent-runtime",
        "auth_mode": "cookie",
        "auth_explain": "粘贴 wps_sid 或整段 Cookie；也可导入本机灵犀客户端登录态",
        "actions": ["scan", "import", "export", "checkin", "refresh-quota"],
        "models_default": len(endpoints.DEFAULT_MODELS),
    }


class ImportIn(BaseModel):
    credential: dict | None = None
    cookie: str | None = None
    #: 导入后是否探活（打一次 profile + balance）。
    probe: bool = True


@router.post("/import")
def import_account(body: ImportIn, _: bool = Depends(require_admin),
                   db: Session = Depends(get_db)):
    record = body.credential if body.credential else body.cookie
    if not record:
        raise HTTPException(400, detail="需要 credential（Cookie 或 sid）")
    try:
        return lingxi_accounts.import_record(db, record, probe=body.probe)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc)) from exc


class BatchIn(BaseModel):
    accounts: list | None = None
    payload: str | None = None
    #: 批量导入默认**不探活**：几十个号逐个打上游会被限流。
    probe: bool = False


@router.post("/import-batch")
def import_batch(body: BatchIn, _: bool = Depends(require_admin),
                 db: Session = Depends(get_db)):
    records: list = list(body.accounts or [])
    if body.payload:
        text = body.payload.strip()
        try:
            data = json.loads(text)
        except Exception:  # noqa: BLE001 - 不是整段 JSON 就按 JSONL 处理
            data = None
        if isinstance(data, dict):
            inner = data.get("accounts")
            if isinstance(inner, list):
                records.extend(inner)
            else:
                records.append(data)
        elif isinstance(data, list):
            records.extend(data)
        elif data is None:
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except Exception:  # noqa: BLE001
                    continue
                if isinstance(item, dict) or isinstance(item, str):
                    records.append(item)
    if not records:
        raise HTTPException(400, detail="没有可导入的账号")

    ok = fail = 0
    results = []
    for record in records[:500]:
        try:
            result = lingxi_accounts.import_record(db, record,
                                                   probe=body.probe)
            if result.get("ok"):
                ok += 1
            else:
                fail += 1
            results.append({"ok": bool(result.get("ok")),
                            "account_id": result.get("account_id"),
                            "uid": result.get("uid"),
                            "error": (result.get("error") or {}).get("message")
                            if isinstance(result.get("error"), dict) else None})
        except Exception as exc:  # noqa: BLE001 - 单条失败不中断批量
            fail += 1
            results.append({"ok": False, "error": str(exc)[:200]})
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass
    return {"ok": True, "imported": ok, "failed": fail,
            "total": len(records), "results": results[:60]}


@router.get("/scan")
def scan(_: bool = Depends(require_admin)):
    return lingxi_accounts.scan_local()


@router.post("/import-local")
def import_local(probe: bool = False, _: bool = Depends(require_admin),
                 db: Session = Depends(get_db)):
    return lingxi_accounts.import_local(db, probe=probe)


@router.post("/keepalive")
def keepalive(realm: str = "", _: bool = Depends(require_admin),
              db: Session = Depends(get_db)):
    return lingxi_accounts.keepalive(db, _realm_or_400(realm))


@router.get("/accounts")
def list_accounts(realm: str = "", _: bool = Depends(require_admin),
                  db: Session = Depends(get_db)):
    from admin.platform.wps_lingxi.platform_gateway import WpsLingxiAccountOps

    return WpsLingxiAccountOps(_realm_or_400(realm)).list(db)


@router.post("/accounts/{acc_id}/refresh")
def refresh(acc_id: int, _: bool = Depends(require_admin),
            db: Session = Depends(get_db)):
    from admin.platform.wps_lingxi.platform_gateway import WpsLingxiAccountOps

    try:
        return WpsLingxiAccountOps("").refresh(db, acc_id)
    except ValueError as exc:
        raise HTTPException(404, detail=str(exc)) from exc


@router.post("/accounts/{acc_id}/health")
def health(acc_id: int, _: bool = Depends(require_admin),
           db: Session = Depends(get_db)):
    from admin.platform.wps_lingxi.platform_gateway import WpsLingxiAccountOps

    return WpsLingxiAccountOps("").health(db, acc_id)


@router.post("/checkin")
def checkin(realm: str = "", _: bool = Depends(require_admin),
            db: Session = Depends(get_db)):
    return lingxi_checkin.run_daily_checkin(db, None, _realm_or_400(realm))


@router.get("/export")
def export(realm: str = "", reveal: int = 0, _: bool = Depends(require_admin),
           db: Session = Depends(get_db)):
    return lingxi_accounts.export_records(db, _realm_or_400(realm),
                                          reveal=bool(int(reveal or 0)))


@router.get("/usage")
def usage(realm: str = "", days: int = 30, _: bool = Depends(require_admin),
          db: Session = Depends(get_db)):
    from admin.platform.wps_lingxi.platform_gateway import WpsLingxiAccountOps

    return WpsLingxiAccountOps(_realm_or_400(realm)).usage(db, days=days)