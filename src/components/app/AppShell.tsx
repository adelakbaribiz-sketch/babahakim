'use client'
// AppShell: responsive sidebar + header (lang switcher, notifications, user menu)
// BabaHakim §7: Sidebar #173F76, active items #225BBE, accents #57AFE2, border #DEDBDB
import React, { useState } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { useApp, logoutUser } from '@/contexts/app'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/constants'
import { Logo } from '@/components/app/shared/Logo'
import {
  LayoutDashboard, User, ClipboardList, ImagePlus, FolderOpen, ShoppingBag, ShoppingCart, Package,
  Ticket, CalendarClock, Stethoscope, Users2, Pill, Tags, BarChart3, ShieldCheck, Bot, MessageSquareText,
  ListChecks, LogOut, Bell, Menu, Languages, Heart, CreditCard, Truck, FileText, Moon, Sun,
} from 'lucide-react'

export interface NavItem { page: string; label: string; icon: React.ReactNode; badge?: number }

export function useNavItems(): NavItem[] {
  const { t, user } = useApp()
  if (!user) return []
  const role = user.role
  if (role === 'PATIENT') return [
    { page: 'dashboard', label: t('dashboard'), icon: <LayoutDashboard size={18} /> },
    { page: 'profile', label: t('profile'), icon: <User size={18} /> },
    { page: 'questionnaire', label: t('questionnaire'), icon: <ClipboardList size={18} /> },
    { page: 'newCase', label: t('newCase'), icon: <ImagePlus size={18} /> },
    { page: 'cases', label: t('myCases'), icon: <FolderOpen size={18} /> },
    { page: 'shop', label: t('shop'), icon: <ShoppingBag size={18} /> },
    { page: 'cart', label: t('cart'), icon: <ShoppingCart size={18} /> },
    { page: 'orders', label: t('orders'), icon: <Package size={18} /> },
    { page: 'tickets', label: t('tickets'), icon: <Ticket size={18} /> },
    { page: 'followups', label: t('followups'), icon: <CalendarClock size={18} /> },
  ]
  if (role === 'EXPERT_1' || role === 'EXPERT_2' || role === 'DOCTOR') return [
    { page: 'dashboard', label: t('dashboard'), icon: <LayoutDashboard size={18} /> },
    { page: 'queue', label: t('queue'), icon: <ListChecks size={18} /> },
    { page: 'tickets', label: t('tickets'), icon: <Ticket size={18} /> },
  ]
  if (role === 'OPERATOR') return [
    { page: 'dashboard', label: t('dashboard'), icon: <LayoutDashboard size={18} /> },
    { page: 'queue', label: t('queue'), icon: <ListChecks size={18} /> },
    { page: 'orders', label: t('orders'), icon: <Package size={18} /> },
    { page: 'payments', label: t('payments'), icon: <CreditCard size={18} /> },
    { page: 'shipments', label: 'ارسال و تحویل', icon: <Truck size={18} /> },
    { page: 'followups', label: t('followups'), icon: <CalendarClock size={18} /> },
    { page: 'tickets', label: t('tickets'), icon: <Ticket size={18} /> },
    { page: 'products', label: t('products'), icon: <Pill size={18} /> },
    { page: 'prices', label: t('prices'), icon: <Tags size={18} /> },
    { page: 'reports', label: t('reports'), icon: <BarChart3 size={18} /> },
  ]
  if (role === 'ADMIN') return [
    { page: 'dashboard', label: t('dashboard'), icon: <LayoutDashboard size={18} /> },
    { page: 'queue', label: t('queue'), icon: <ListChecks size={18} /> },
    { page: 'users', label: t('users'), icon: <Users2 size={18} /> },
    { page: 'diseases', label: t('diseases'), icon: <Stethoscope size={18} /> },
    { page: 'products', label: t('products'), icon: <Pill size={18} /> },
    { page: 'prices', label: t('prices'), icon: <Tags size={18} /> },
    { page: 'reports', label: t('reports'), icon: <BarChart3 size={18} /> },
    { page: 'auditLogs', label: t('auditLogs'), icon: <ShieldCheck size={18} /> },
    { page: 'questionnaireEditor', label: t('questionnaireEditor'), icon: <FileText size={18} /> },
    { page: 'aiModels', label: t('aiModels'), icon: <Bot size={18} /> },
    { page: 'smsLog', label: t('smsLog'), icon: <MessageSquareText size={18} /> },
  ]
  return []
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang, user, setUser, navigate, view, notifCount } = useApp()
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = useNavItems()

  const roleLabel = user ? (ROLE_LABELS as Record<string, { fa: string; en: string }>)[user.role]?.[lang] || user.role : ''

  const sidebar = (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-sidebar-border">
        <Logo size={38} variant="light" />
        <div>
          <div className="font-bold leading-tight text-white">{t('appName')}</div>
          <div className="text-[10px] text-sidebar-foreground/70">{roleLabel}</div>
        </div>
      </div>
      <ScrollArea className="flex-1 py-2">
        <nav className="px-2 space-y-0.5">
          {items.map((item) => (
            <button key={item.page} onClick={() => { navigate(item.page); setMobileOpen(false) }}
              aria-current={view.page === item.page ? 'page' : undefined}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-start',
                view.page === item.page || (item.page !== 'dashboard' && view.page.startsWith(item.page))
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm'
                  : 'text-sidebar-foreground/85 hover:bg-white/10 hover:text-white',
              )}>
              {item.icon}
              <span className="truncate">{item.label}</span>
              {item.page === 'notifications' && notifCount > 0 && <Badge className="ms-auto bg-[#57AFE2] text-[#173F76] font-bold">{notifCount}</Badge>}
            </button>
          ))}
        </nav>
      </ScrollArea>
      <div className="p-3 border-t border-sidebar-border">
        <div className="text-[11px] text-sidebar-foreground/75 leading-relaxed px-2 pb-2">{t('disclaimerMedical')}</div>
        <Button variant="outline" className="w-full justify-start gap-2 border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => logoutUser(setUser, navigate)}>
          <LogOut size={16} /> {t('logout')}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-16 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-40 flex items-center gap-3 px-4">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><Menu /></Button>
          </SheetTrigger>
          <SheetContent side={lang === 'fa' ? 'right' : 'left'} className="p-0 w-72 bg-sidebar">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
        <button className="md:hidden flex items-center gap-2" onClick={() => navigate('dashboard')} aria-label={t('appName')}>
          <Logo size={30} variant="dark" />
          <span className="font-bold">{t('appName')}</span>
        </button>
        <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
          <Heart size={14} className="text-[#225BBE]" />
          {t('appDesc')}
        </div>
        <div className="ms-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')} className="gap-1.5">
            <Languages size={16} /> {lang === 'fa' ? 'EN' : 'فا'}
          </Button>
          <NotificationBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full hover:bg-muted p-1 ps-2 transition-colors" aria-label="User menu">
                <span className="hidden sm:block text-xs font-medium">{user?.firstName} {user?.lastName}</span>
                <Avatar className="size-8">
                  <AvatarFallback className="bg-[#173F76]/10 text-[#173F76] dark:bg-[#57AFE2]/15 dark:text-[#9CCBEF] text-xs font-bold">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-3 py-2 text-xs text-muted-foreground">{user?.phone}<br />{roleLabel}</div>
              <DropdownMenuSeparator />
              {user?.role === 'PATIENT' && (
                <DropdownMenuItem onClick={() => navigate('profile')}><User size={14} className="me-2" />{t('profile')}</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate('notifications')}><Bell size={14} className="me-2" />{t('notifications')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logoutUser(setUser, navigate)} className="text-rose-600"><LogOut size={14} className="me-2" />{t('logout')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden md:flex w-72 shrink-0 border-e border-sidebar-border">
          <div className="w-full">{sidebar}</div>
        </aside>
        <main className="flex-1 min-w-0 p-4 md:p-6 max-w-[1400px] w-full mx-auto">{children}</main>
      </div>
      <footer className="mt-auto bg-[#173F76] dark:bg-[#0F2440] text-white/80 py-3 px-4 text-center text-[11px]">
        {t('appName')} — {t('appDesc')} · {t('disclaimerMedical')}
      </footer>
    </div>
  )
}

function ThemeToggle() {
  // CSS-driven (mounted-state-free) to avoid hydration mismatch & effect setState
  const { setTheme, resolvedTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      suppressHydrationWarning
      aria-label="Theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Moon size={17} className="dark:hidden" />
      <Sun size={17} className="hidden dark:block text-[#57AFE2]" />
    </Button>
  )
}

function NotificationBell() {
  const { t, lang, navigate, notifCount, api } = useApp()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<{ id: string; titleFa: string; titleEn: string; bodyFa?: string; bodyEn?: string; createdAt: string; read: boolean }[]>([])

  const load = async () => {
    try {
      const d = await api<{ notifications: typeof items }>('/api/v1/notifications')
      setItems(d.notifications.slice(0, 12))
    } catch { /* noop */ }
  }

  return (
    <DropdownMenu open={open} onOpenChange={(o) => { setOpen(o); if (o) load() }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t('notifications')}>
          <Bell size={18} />
          {notifCount > 0 && <span className="absolute -top-0.5 -end-0.5 size-4 rounded-full bg-[#57AFE2] text-[#173F76] text-[9px] font-bold flex items-center justify-center">{notifCount}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t('notifications')}</span>
          <Link href="#" onClick={(e) => { e.preventDefault(); api('/api/v1/notifications', { method: 'PATCH', json: {} }); navigate('notifications') }} className="text-[11px] text-primary">{t('markAllRead')}</Link>
        </div>
        {items.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('empty')}</div>}
        {items.map((n) => (
          <DropdownMenuItem key={n.id} className="items-start py-2.5" onClick={() => navigate('notifications')}>
            <div className="w-full">
              <div className={`text-xs ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{lang === 'fa' ? n.titleFa : n.titleEn}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{lang === 'fa' ? n.bodyFa : n.bodyEn}</div>
            </div>
            {!n.read && <span className="size-1.5 rounded-full bg-[#57AFE2] shrink-0 mt-1.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
