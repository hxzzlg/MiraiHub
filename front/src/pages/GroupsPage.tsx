import { App as AntdApp, Button, Card, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import PageHeader from '../components/PageHeader'
import { FMT_EMPTY, fmtInt } from '../utils/format'

interface Group {
  id: number
  name: string
  note: string
  models: string[]
  model_count: number
  effective_count: number
  key_count: number
  created_at?: string
}

export default function GroupsPage() {
  const { message } = AntdApp.useApp()
  const [items, setItems] = useState<Group[]>([])
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Group | null>(null)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [modelSearch, setModelSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [g, m] = await Promise.all([
        api<{ items: Group[] }>('/api/groups'),
        api<{ items: { model_id: string; enabled: boolean }[] }>('/api/models/configs'),
      ])
      setItems(g.items ?? [])
      setModels((m.items ?? []).filter((x) => x.enabled).map((x) => x.model_id))
    } catch (e) {
      message.error((e as Error).message || '分组加载失败')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openEditor = (g?: Group) => {
    setEditing(g ?? null)
    form.setFieldsValue({ name: g?.name, note: g?.note, models: g?.models ?? [] })
    setModelSearch('')
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    const body = { name: v.name, note: v.note ?? '', models: v.models ?? [] }
    try {
      if (editing) await api(`/api/groups/${editing.id}`, { method: 'PUT', body })
      else await api('/api/groups', { method: 'POST', body })
      message.success('分组已保存')
      setOpen(false)
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const remove = async (g: Group) => {
    try {
      const r = await api<{ unbound_keys?: number }>(`/api/groups/${g.id}`, { method: 'DELETE' })
      message.success(`已删除${r.unbound_keys ? `（解绑 ${fmtInt(r.unbound_keys)} 个 Key）` : ''}`)
      void load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const filteredModels = models.filter((m) => m.toLowerCase().includes(modelSearch.toLowerCase()))

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <PageHeader
        title="模型分组"
        description="分组限制 Key 可调用的模型范围"
        onRefresh={() => void load()}
        refreshing={loading}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建分组
          </Button>
        }
      />
      <Card size="small">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name', render: (v) => <Typography.Text strong>{v}</Typography.Text> },
            { title: '模型数', dataIndex: 'model_count', width: 100, align: 'right', render: (v, r) => <span className="num">{fmtInt(v)}{r.effective_count !== r.model_count ? `（可用 ${fmtInt(r.effective_count)}）` : ''}</span> },
            { title: '绑定 Key', dataIndex: 'key_count', width: 100, align: 'right', render: (v) => <span className="num">{fmtInt(v)}</span> },
            {
              title: '模型',
              dataIndex: 'models',
              ellipsis: true,
              render: (v: string[]) => (
                <Space wrap size={4}>
                  {v.slice(0, 8).map((m) => (
                    <Tag key={m} style={{ fontSize: 11 }}>
                      {m}
                    </Tag>
                  ))}
                  {v.length > 8 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>+{v.length - 8}</Typography.Text>}
                  {!v.length && FMT_EMPTY}
                </Space>
              ),
            },
            { title: '备注', dataIndex: 'note', ellipsis: true, render: (v) => v || FMT_EMPTY },
            {
              title: '操作',
              width: 130,
              render: (_, g) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => openEditor(g)}>
                    编辑
                  </Button>
                  <Popconfirm title={`删除分组 ${g.name}？（绑定的 Key 将失去分组限制）`} onConfirm={() => void remove(g)}>
                    <Button type="link" size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? `编辑分组：${editing.name}` : '新建分组'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        width={680}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入分组名' }]}>
            <Input placeholder="如：仅免费模型" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="包含模型">
            <Input.Search allowClear placeholder="搜索模型" style={{ marginBottom: 8 }} onSearch={setModelSearch} onChange={(e) => !e.target.value && setModelSearch('')} />
            <Form.Item noStyle name="models">
              <Select mode="multiple" placeholder="必选：至少选择一个启用模型" maxTagCount={10} options={filteredModels.map((m) => ({ value: m, label: m }))} showSearch={{ optionFilterProp: 'label' }} />
            </Form.Item>
            <Space style={{ marginTop: 8 }}>
              <Button size="small" onClick={() => form.setFieldValue('models', filteredModels)}>
                全选（搜索结果）
              </Button>
              <Button size="small" onClick={() => form.setFieldValue('models', [])}>
                清空
              </Button>
              <Checkbox
                checked={false}
                onChange={() => {
                  /* 占位避免无谓渲染 */
                }}
                style={{ display: 'none' }}
              />
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
