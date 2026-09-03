'use client'
// Admin views: Users, Diseases, Products management
import React, { useCallback, useEffect, useState } from 'react'
import { useApp } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { SectionCard, JalaliDate, LoadingRows, EmptyState, Money, StatusBadge } from '../../shared/atoms'
import { ROLE_LABELS, ROLE_PERMISSIONS } from '@/lib/constants'
import { Users2, Stethoscope, Pill, Plus, ShieldCheck, ShieldOff, CheckCircle2 } from 'lucide-react'

// ── Users ───────────────────────────────────────────────────────────────
export function AdminUsersPage() {
  const { t, lang, api } = useApp()
  const [users, setUsers] = useState<{ id: string; firstName: string; lastName: string; phone: string; email?: string; role: string; isActive: boolean; referralCode?: string; createdAt: string; lastLoginAt?: string; profile?: { province?: string; city?: string } | null }[]>([])
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api<{ users: typeof users }>(`/api/v1/admin/users?q=${encodeURIComponent(q)}${role && role !== 'ALL' ? `&role=${role}` : ''}`).then((d) => setUsers(d.users)).catch(() => {})
  }, [api, q, role, reload])

  async function patch(id: string, data: Record<string, unknown>) {
    try {
      await api('/api/v1/admin/users', { method: 'PATCH', json: { id, ...data } })
      toast.success('✓'); setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Users2 size={22} />{t('users')}</h1>
        <div className="ms-auto flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-52" />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-40"><SelectValue placeholder={t('all')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('all')}</SelectItem>
              {Object.keys(ROLE_LABELS).map((r) => <SelectItem key={r} value={r}>{lang === 'fa' ? ROLE_LABELS[r as keyof typeof ROLE_LABELS].fa : ROLE_LABELS[r as keyof typeof ROLE_LABELS].en}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {users.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id}>
              <CardContent className="p-3.5 flex items-center gap-3 flex-wrap text-sm">
                <div className="min-w-40">
                  <div className="font-medium">{u.firstName} {u.lastName}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{u.phone}{u.email ? ` · ${u.email}` : ''}</div>
                </div>
                <Select value={u.role} onValueChange={(v) => patch(u.id, { role: v })}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(ROLE_LABELS).map((r) => <SelectItem key={r} value={r}>{lang === 'fa' ? ROLE_LABELS[r as keyof typeof ROLE_LABELS].fa : r}</SelectItem>)}</SelectContent>
                </Select>
                <Badge variant="outline" className="text-[10px]">{u.profile?.province || '—'}</Badge>
                <span className="text-xs text-muted-foreground"><JalaliDate date={u.createdAt} /></span>
                <div className="ms-auto flex items-center gap-2">
                  {u.role === 'PATIENT' && <Badge variant="secondary" className="text-[10px]">{u.referralCode?.slice(0, 12)}</Badge>}
                  {u.isActive ? (
                    <Button variant="outline" size="sm" className="gap-1 text-amber-600 h-8" onClick={() => patch(u.id, { isActive: false })}><ShieldOff size={13} />غیرفعال</Button>
                  ) : (
                    <Button variant="outline" size="sm" className="gap-1 text-[#225BBE] dark:text-[#57AFE2] h-8" onClick={() => patch(u.id, { isActive: true })}><ShieldCheck size={13} />فعال</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <SectionCard title={lang === 'fa' ? 'ماتریس دسترسی (RBAC)' : 'RBAC matrix'}>
        <div className="overflow-x-auto text-xs">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b">
                <th className="text-start p-2">{t('status')}</th>
                {Object.keys(ROLE_LABELS).map((r) => <th key={r} className="p-2 text-center">{lang === 'fa' ? ROLE_LABELS[r as keyof typeof ROLE_LABELS].fa : r}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...new Set(Object.values(ROLE_PERMISSIONS).flat())].sort().slice(0, 18).map((perm) => (
                <tr key={perm} className="border-b border-border/40">
                  <td className="p-2 font-mono text-[10px]" dir="ltr">{perm}</td>
                  {Object.keys(ROLE_LABELS).map((r) => (
                    <td key={r} className="p-2 text-center">{(ROLE_PERMISSIONS as Record<string, string[]>)[r]?.includes(perm) ? <CheckCircle2 size={13} className="text-emerald-600 mx-auto" /> : <span className="text-muted-foreground">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

// ── Diseases ────────────────────────────────────────────────────────────
export function AdminDiseasesPage() {
  const { t, lang, api } = useApp()
  const [diseases, setDiseases] = useState<{ id: string; code: string; nameFa: string; nameEn: string; category?: string; descriptionFa?: string; symptomsFa?: string; expertNotes?: string; active: boolean }[]>([])
  const [edit, setEdit] = useState<Partial<{ id: string; code: string; nameFa: string; nameEn: string; category: string; descriptionFa: string; symptomsFa: string; expertNotes: string }>>({})
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api<{ diseases: typeof diseases }>('/api/v1/admin/diseases').then((d) => setDiseases(d.diseases)).catch(() => {})
  }, [api, reload])

  async function save() {
    try {
      if (edit.id) await api('/api/v1/admin/diseases', { method: 'PATCH', json: edit })
      else await api('/api/v1/admin/diseases', { method: 'POST', json: edit })
      toast.success('✓'); setEdit({}); setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) }
  }
  async function toggle(d: { id: string; active: boolean }) {
    await api('/api/v1/admin/diseases', { method: 'PATCH', json: { id: d.id, active: !d.active } })
    setReload((x) => x + 1)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Stethoscope size={22} />{t('diseases')}</h1>
        <Button size="sm" className="ms-auto gap-1.5" onClick={() => setEdit({})}><Plus size={14} />{lang === 'fa' ? 'بیماری جدید' : 'New'}</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {diseases.map((d) => (
          <Card key={d.id} className={!d.active ? 'opacity-60' : ''}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">{d.code}</Badge>
                <span className="font-bold text-sm">{lang === 'fa' ? d.nameFa : d.nameEn}</span>
                <Badge variant="secondary" className="text-[10px] ms-auto">{d.category || '—'}</Badge>
              </div>
              {d.descriptionFa && <p className="text-xs text-muted-foreground leading-relaxed">{d.descriptionFa}</p>}
              {d.symptomsFa && <p className="text-xs text-muted-foreground">🔬 {d.symptomsFa}</p>}
              {d.expertNotes && <p className="text-xs text-primary">💬 {d.expertNotes}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="h-7" onClick={() => setEdit(d)}>{t('details')}</Button>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => toggle(d)}>{d.active ? 'غیرفعال' : 'فعال'}</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!edit || edit === {}} onOpenChange={(o) => !o && setEdit(undefined as never)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? t('details') : lang === 'fa' ? 'بیماری جدید' : 'New disease'}</DialogTitle></DialogHeader>
          {edit !== undefined && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">کد</Label><Input value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} dir="ltr" disabled={!!edit.id} /></div>
                <div className="space-y-1"><Label className="text-xs">دسته</Label><Input value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">نام فارسی</Label><Input value={edit.nameFa || ''} onChange={(e) => setEdit({ ...edit, nameFa: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">نام انگلیسی</Label><Input value={edit.nameEn || ''} onChange={(e) => setEdit({ ...edit, nameEn: e.target.value })} dir="ltr" /></div>
              <div className="space-y-1"><Label className="text-xs">توضیحات</Label><Textarea rows={2} value={edit.descriptionFa || ''} onChange={(e) => setEdit({ ...edit, descriptionFa: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">علائم</Label><Textarea rows={2} value={edit.symptomsFa || ''} onChange={(e) => setEdit({ ...edit, symptomsFa: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">توضیحات کارشناسی</Label><Textarea rows={2} value={edit.expertNotes || ''} onChange={(e) => setEdit({ ...edit, expertNotes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter><Button onClick={save} disabled={!edit?.nameFa || !edit?.code}>{t('save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Products (management) ───────────────────────────────────────────────
export function AdminProductsPage() {
  const { t, lang, api } = useApp()
  const [products, setProducts] = useState<{ id: string; sku: string; nameFa: string; nameEn: string; brand?: string; category?: string; currentPrice: number; purchasePrice: number; stock: number; active: boolean; requiresPrescription: boolean; priceHistory: { id: string; oldPrice?: number; newPrice: number; reason: string; createdAt: string; changedBy: { firstName: string; lastName: string } }[] }[]>([])
  const [edit, setEdit] = useState<Record<string, string | number | boolean>>({})
  const [reload, setReload] = useState(0)

  useEffect(() => {
    api<{ products: typeof products }>('/api/v1/admin/products').then((d) => setProducts(d.products)).catch(() => {})
  }, [api, reload])

  async function save() {
    try {
      if (edit.id) await api('/api/v1/admin/products', { method: 'PATCH', json: edit })
      else await api('/api/v1/admin/products', { method: 'POST', json: edit })
      toast.success('✓'); setEdit({}); setReload((x) => x + 1)
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Pill size={22} />{t('products')}</h1>
        <Button size="sm" className="ms-auto gap-1.5" onClick={() => setEdit({ sku: '', nameFa: '', currentPrice: 0, stock: 0 })}><Plus size={14} />{lang === 'fa' ? 'محصول جدید' : 'New'}</Button>
      </div>
      {products.length === 0 ? <EmptyState /> : (
        <div className="space-y-2">
          {products.map((p) => (
            <Card key={p.id} className={!p.active ? 'opacity-60' : ''}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3 flex-wrap text-sm">
                  <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">{p.sku}</Badge>
                  <span className="font-bold">{p.nameFa}</span>
                  <span className="text-xs text-muted-foreground">{p.brand} · {p.category}</span>
                  {p.requiresPrescription ? <Badge className="text-[10px] bg-amber-600 text-white">Rx</Badge> : <Badge variant="secondary" className="text-[10px]">OTC</Badge>}
                  <span className="ms-auto font-bold tabular-nums text-primary"><Money amount={p.currentPrice} /></span>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                  <span>{lang === 'fa' ? 'موجودی' : 'Stock'}: <b className={p.stock <= 5 ? 'text-rose-600' : ''}>{p.stock}</b></span>
                  <span>{lang === 'fa' ? 'قیمت خرید' : 'Purchase'}: {new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US').format(p.purchasePrice)}</span>
                </div>
                {p.priceHistory.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{t('history')} ({p.priceHistory.length})</summary>
                    <div className="mt-2 space-y-1 ps-3 border-s">
                      {p.priceHistory.map((h) => (
                        <div key={h.id} className="flex justify-between text-muted-foreground">
                          <span>{h.oldPrice ? `${new Intl.NumberFormat('fa-IR').format(h.oldPrice)} → ` : ''}<b>{new Intl.NumberFormat('fa-IR').format(h.newPrice)}</b> · {h.reason}</span>
                          <span><JalaliDate date={h.createdAt} /></span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7" onClick={() => setEdit({ id: p.id, sku: p.sku, nameFa: p.nameFa, brand: p.brand || '', category: p.category || '', currentPrice: p.currentPrice, stock: p.stock, requiresPrescription: p.requiresPrescription, active: p.active })}>{t('details')}</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Object.keys(edit).length > 0} onOpenChange={(o) => !o && setEdit({})}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit.id ? t('details') : lang === 'fa' ? 'محصول جدید' : 'New product'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">SKU</Label><Input value={String(edit.sku || '')} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} dir="ltr" disabled={!!edit.id} /></div>
              <div className="space-y-1"><Label className="text-xs">دسته</Label><Input value={String(edit.category || '')} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">نام فارسی</Label><Input value={String(edit.nameFa || '')} onChange={(e) => setEdit({ ...edit, nameFa: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">برند</Label><Input value={String(edit.brand || '')} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1"><Label className="text-xs">قیمت (تومان)</Label><Input type="number" value={Number(edit.currentPrice || 0)} onChange={(e) => setEdit({ ...edit, currentPrice: Number(e.target.value) })} dir="ltr" /></div>
              <div className="space-y-1"><Label className="text-xs">موجودی</Label><Input type="number" value={Number(edit.stock || 0)} onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value) })} dir="ltr" /></div>
              <div className="space-y-1"><Label className="text-xs">قیمت خرید</Label><Input type="number" value={Number(edit.purchasePrice || 0)} onChange={(e) => setEdit({ ...edit, purchasePrice: Number(e.target.value) })} dir="ltr" /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={Boolean(edit.requiresPrescription)} onCheckedChange={(v) => setEdit({ ...edit, requiresPrescription: v })} id="rx" />
              <Label htmlFor="rx" className="text-xs">نیازمند نسخه</Label>
            </div>
          </div>
          <DialogFooter><Button onClick={save} disabled={!edit.nameFa || (!edit.id && !edit.sku)}>{t('save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
