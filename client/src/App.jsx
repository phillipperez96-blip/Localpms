import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './lib/store.jsx';
import Layout, { allowed } from './components/Layout.jsx';
import { Spinner, Toasts } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tenants from './pages/Tenants.jsx';
import TenantAccount from './pages/TenantAccount.jsx';
import MoveIn from './pages/MoveIn.jsx';
import Units from './pages/Units.jsx';
import Leads from './pages/Leads.jsx';
import PastDues from './pages/PastDues.jsx';
import Communications from './pages/Communications.jsx';
import Merchandise from './pages/Merchandise.jsx';
import DailyClose from './pages/DailyClose.jsx';
import Rates from './pages/Rates.jsx';
import Reminders from './pages/Reminders.jsx';
import Walkthrough from './pages/Walkthrough.jsx';
import Gate from './pages/Gate.jsx';
import Audits from './pages/Audits.jsx';
import AuditDetail from './pages/AuditDetail.jsx';
import Reports from './pages/Reports.jsx';
import ActivityLog from './pages/ActivityLog.jsx';
import Settings from './pages/Settings.jsx';
import Letter from './pages/Letter.jsx';

function Guard({ perm, children }) {
  const { can } = useApp();
  if (!allowed(can, perm)) return <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-slate-600">You don't have permission to view this page. Ask an administrator to update your role.</div>;
  return children;
}

export default function App() {
  const { me, loading, can } = useApp();
  if (loading) return <Spinner className="h-full" />;
  if (!me) return <><Login /><Toasts /></>;
  return (
    <>
      <Routes>
        <Route path="/letter/:id" element={<Letter />} />
        <Route element={<Layout />}>
          <Route index element={can('dashboard.view') ? <Dashboard /> : <Navigate to="/reminders" />} />
          <Route path="tenants" element={<Guard perm="tenants.view"><Tenants /></Guard>} />
          <Route path="tenants/:id" element={<Guard perm="tenants.view"><TenantAccount /></Guard>} />
          <Route path="move-in" element={<Guard perm="movein.perform"><MoveIn /></Guard>} />
          <Route path="units" element={<Guard perm="units.view"><Units /></Guard>} />
          <Route path="leads" element={<Guard perm="leads.manage"><Leads /></Guard>} />
          <Route path="past-dues" element={<Guard perm="pastdue.manage"><PastDues /></Guard>} />
          <Route path="communications" element={<Guard perm="communications.send"><Communications /></Guard>} />
          <Route path="merchandise" element={<Guard perm={['merch.sell', 'inventory.manage']}><Merchandise /></Guard>} />
          <Route path="daily-close" element={<Guard perm="dailyclose.perform"><DailyClose /></Guard>} />
          <Route path="rates" element={<Guard perm="rates.manage"><Rates /></Guard>} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="walkthrough" element={<Guard perm="walkthrough.view"><Walkthrough /></Guard>} />
          <Route path="gate" element={<Guard perm="gate.manage"><Gate /></Guard>} />
          <Route path="audits" element={<Guard perm={['audits.view', 'audits.perform']}><Audits /></Guard>} />
          <Route path="audits/:id" element={<Guard perm={['audits.view', 'audits.perform']}><AuditDetail /></Guard>} />
          <Route path="reports" element={<Guard perm="reports.view"><Reports /></Guard>} />
          <Route path="activity" element={<Guard perm="activity.view"><ActivityLog /></Guard>} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
