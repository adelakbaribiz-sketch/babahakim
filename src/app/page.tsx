'use client'
// BabaHakim (babahakim / باباحکیم) — bilingual AI tongue-diagnosis platform
// Single-page app with client-side view routing (all users land on /)
import React from 'react'
import { AppProvider, useApp } from '@/contexts/app'
import { AppShell } from '@/components/app/AppShell'
import { AppToaster } from '@/components/app/AppToaster'
import { DesignSystemView } from '@/components/app/views/DesignSystemView'
import { Landing } from '@/components/app/views/Landing'
import { AuthView } from '@/components/app/views/AuthView'
import { PatientDashboard, ProfilePage, QuestionnairePage, NewCasePage, CasesList, CaseDetailForPatient } from '@/components/app/views/patient/PatientViews'
import { ShopPage, CartPage, OrdersPage, TicketsPage, FollowupsPage, NotificationsPage } from '@/components/app/views/patient/ShopViews'
import { StaffDashboard, QueuePage, PaymentsVerifyPage, ShipmentsPage } from '@/components/app/views/staff/StaffViews'
import { CaseWorkspace } from '@/components/app/views/CaseWorkspace'
import { AdminUsersPage, AdminDiseasesPage, AdminProductsPage } from '@/components/app/views/admin/AdminViews'
import { AdminPricesPage, AdminReportsPage, AdminAuditPage, AdminQuestionnairePage, AdminAIModelsPage, AdminSMSPage } from '@/components/app/views/admin/AdminViews2'

function Router() {
  const { user, view, navigate } = useApp()

  // public (incl. design-system style guide — ED-85)
  if (!user) {
    if (view.page === 'login' || view.page === 'register') return <AuthView />
    if (view.page === 'designSystem') return <DesignSystemView navigate={navigate} />
    return <Landing />
  }

  const page = view.page
  const role = user.role

  let content: React.ReactNode
  if (page === 'designSystem') content = <DesignSystemView navigate={navigate} />
  else if (page === 'dashboard') content = <PatientDashboard navigate={navigate} />
  else if (page === 'profile') content = <ProfilePage />
  else if (page === 'questionnaire') content = <QuestionnairePage />
  else if (page === 'newCase') content = <NewCasePage />
  else if (page === 'cases') content = <CasesList navigate={navigate} />
  else if (page === 'caseDetail' && view.params?.id) {
    content = role === 'PATIENT'
      ? <CaseDetailForPatient id={view.params.id} navigate={navigate} />
      : <CaseWorkspace caseId={view.params.id} onChanged={() => navigate('queue')} />
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
  else if (page === 'reports') content = <AdminReportsPage />
  else if (page === 'auditLogs') content = <AdminAuditPage />
  else if (page === 'questionnaireEditor') content = <AdminQuestionnairePage />
  else if (page === 'aiModels') content = <AdminAIModelsPage />
  else if (page === 'smsLog') content = <AdminSMSPage />
  else {
    // role default
    if (role === 'PATIENT') content = <PatientDashboard navigate={navigate} />
    else content = <StaffDashboard navigate={navigate} />
  }

  return <AppShell>{content}</AppShell>
}

export default function Home() {
  return (
    <AppProvider>
      <RouterWithStaffDefault />
      {/* PHASE 07: direction-aware toaster inside provider tree */}
      <AppToaster />
    </AppProvider>
  )
}

function RouterWithStaffDefault() {
  const { user, view, navigate } = useApp()
  if (!user) {
    if (view.page === 'login' || view.page === 'register') return <AuthView />
    if (view.page === 'designSystem') return <DesignSystemView navigate={navigate} />
    return <Landing />
  }
  if (view.page === 'dashboard' && user.role !== 'PATIENT') {
    return <AppShell><StaffDashboard navigate={navigate} /></AppShell>
  }
  return <Router />
}
