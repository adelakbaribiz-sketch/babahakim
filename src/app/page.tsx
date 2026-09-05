'use client'
// BabaHakim (babahakim / باباحکیم) — bilingual AI tongue-diagnosis platform
// Single-page app with client-side view routing (all users land on /).
//
// PHASE 09 router (ED-112): declarative ROUTES registry + permission gate +
// 403/404 views + code splitting (recharts/design-system/case-workspace are
// lazy chunks — F02). View authz mirrors the server RBAC matrix; the API
// guard stays authoritative (ED-77).
import React from 'react'
import dynamic from 'next/dynamic'
import { AppProvider, useApp } from '@/contexts/app'
import { AppShell } from '@/components/app/AppShell'
import { AppToaster } from '@/components/app/AppToaster'
import { LoadingRows } from '@/components/app/shared/atoms'
import { canViewRoute, ROUTES } from '@/components/app/routes'
import { ForbiddenView, NotFoundView } from '@/components/app/views/system'
import { Landing } from '@/components/app/views/Landing'
import { AuthView } from '@/components/app/views/AuthView'
import { PatientDashboard, ProfilePage, QuestionnairePage, NewCasePage, CasesList } from '@/components/app/views/patient/PatientViews'
import { ShopPage, CartPage, OrdersPage, TicketsPage, FollowupsPage, NotificationsPage } from '@/components/app/views/patient/ShopViews'
import { StaffDashboard, QueuePage, PaymentsVerifyPage, ShipmentsPage } from '@/components/app/views/staff/StaffViews'

// ── lazy chunks (F02: keep recharts, DS showcase & the 545-line workspace
// out of the first-paint bundle; skeletons while loading) ─────────────────
const CaseWorkspace = dynamic(() => import('@/components/app/views/CaseWorkspace').then((m) => m.CaseWorkspace), { loading: () => <LoadingRows rows={6} /> })
const DesignSystemView = dynamic(() => import('@/components/app/views/DesignSystemView').then((m) => m.DesignSystemView), { loading: () => <LoadingRows rows={5} /> })
const AdminUsersPage = dynamic(() => import('@/components/app/views/admin/AdminViews').then((m) => m.AdminUsersPage), { loading: () => <LoadingRows rows={5} /> })
const AdminDiseasesPage = dynamic(() => import('@/components/app/views/admin/AdminViews').then((m) => m.AdminDiseasesPage), { loading: () => <LoadingRows rows={5} /> })
const AdminProductsPage = dynamic(() => import('@/components/app/views/admin/AdminViews').then((m) => m.AdminProductsPage), { loading: () => <LoadingRows rows={5} /> })
const AdminPricesPage = dynamic(() => import('@/components/app/views/admin/AdminViews2').then((m) => m.AdminPricesPage), { ssr: false, loading: () => <LoadingRows rows={5} /> })
// PHASE 14: permission-aware Reports Center (replaces the legacy charts page)
const ReportsCenter = dynamic(() => import('@/components/app/views/admin/ReportsCenter').then((m) => m.ReportsCenter), { ssr: false, loading: () => <LoadingRows rows={5} /> })
const AdminAuditPage = dynamic(() => import('@/components/app/views/admin/AdminViews2').then((m) => m.AdminAuditPage), { ssr: false, loading: () => <LoadingRows rows={5} /> })
const AdminQuestionnairePage = dynamic(() => import('@/components/app/views/admin/AdminViews2').then((m) => m.AdminQuestionnairePage), { ssr: false, loading: () => <LoadingRows rows={5} /> })
const AdminAIModelsPage = dynamic(() => import('@/components/app/views/admin/AdminViews2').then((m) => m.AdminAIModelsPage), { ssr: false, loading: () => <LoadingRows rows={5} /> })
const AdminSMSPage = dynamic(() => import('@/components/app/views/admin/AdminViews2').then((m) => m.AdminSMSPage), { ssr: false, loading: () => <LoadingRows rows={5} /> })
const AdminIntegrationsPage = dynamic(() => import('@/components/app/views/admin/AdminViews3').then((m) => m.AdminIntegrationsPage), { ssr: false, loading: () => <LoadingRows rows={5} /> })

function Router() {
  const { user, view, navigate, permissions, booted } = useApp()

  // PHASE 09: hold first paint while /auth/me resolves — no landing flash on
  // session refresh (SP-7 loading discipline at the shell level).
  if (!booted) return <div className="min-h-screen bg-background" aria-busy="true" data-state="loading" />

  // public views (incl. design-system style guide — ED-85)
  if (!user) {
    if (view.page === 'login' || view.page === 'register') return <AuthView />
    if (view.page === 'designSystem') return <DesignSystemView navigate={navigate} />
    return <Landing />
  }

  const page = view.page

  // unknown route → 404 (F24: no silent fallthrough)
  if (!ROUTES[page]) return <AppShell><NotFoundView /></AppShell>

  // permission/role gate → 403 (F11: never render a view the RBAC denies)
  if (!canViewRoute(page, user, permissions)) return <AppShell><ForbiddenView /></AppShell>

  let content: React.ReactNode
  if (page === 'designSystem') content = <DesignSystemView navigate={navigate} />
  else if (page === 'dashboard') content = user.role === 'PATIENT' ? <PatientDashboard navigate={navigate} /> : <StaffDashboard navigate={navigate} />
  else if (page === 'profile') content = <ProfilePage />
  else if (page === 'questionnaire') content = <QuestionnairePage />
  else if (page === 'newCase') content = <NewCasePage />
  else if (page === 'cases') content = <CasesList navigate={navigate} />
  else if (page === 'caseDetail') {
    if (!view.params?.id) content = <NotFoundView />
    else content = <CaseWorkspace caseId={view.params.id} onChanged={() => navigate(user.role === 'PATIENT' ? 'cases' : 'queue')} />
  } else if (page === 'shop') content = <ShopPage />
  else if (page === 'cart') content = <CartPage />
  else if (page === 'orders') content = <OrdersPage />
  else if (page === 'tickets') content = <TicketsPage />
  else if (page === 'followups') content = <FollowupsPage />
  else if (page === 'notifications') content = <NotificationsPage />
  else if (page === 'queue') content = <QueuePage navigate={navigate} />
  else if (page === 'payments') content = <PaymentsVerifyPage />
  else if (page === 'shipments') content = <ShipmentsPage />
  else if (page === 'users') content = <AdminUsersPage />
  else if (page === 'diseases') content = <AdminDiseasesPage />
  else if (page === 'products') content = <AdminProductsPage />
  else if (page === 'prices') content = <AdminPricesPage />
  else if (page === 'reports') content = <ReportsCenter />
  else if (page === 'auditLogs') content = <AdminAuditPage />
  else if (page === 'questionnaireEditor') content = <AdminQuestionnairePage />
  else if (page === 'aiModels') content = <AdminAIModelsPage />
  else if (page === 'smsLog') content = <AdminSMSPage />
  else if (page === 'integrations') content = <AdminIntegrationsPage />
  else content = <NotFoundView />

  return <AppShell>{content}</AppShell>
}

export default function Home() {
  return (
    <AppProvider>
      <Router />
      {/* PHASE 07: direction-aware toaster inside provider tree */}
      <AppToaster />
    </AppProvider>
  )
}
