// Shared helpers: dates, money, defaults.

export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => toISO(new Date());
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toISO(d); };
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000); // a - b
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
/** Add months, keeping the anchor day-of-month (clamped to month length). */
export const addMonths = (s, n, anchorDay) => {
  const d = parse(s);
  const day = anchorDay || d.getDate();
  const y = d.getFullYear(), m = d.getMonth() + n;
  const t = new Date(y, m, 1);
  t.setDate(Math.min(day, daysInMonth(t.getFullYear(), t.getMonth())));
  return toISO(t);
};
export const monthStart = (s = today()) => s.slice(0, 8) + '01';
export const monthEnd = (s = today()) => { const d = parse(s); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const money = (n) => '$' + round2(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const nowISO = () => new Date().toISOString();
export const jparse = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };

export const DEFAULT_LATE_FEES = [
  { day: 6, name: 'Late Fee', type: 'flat', amount: 20 },
  { day: 15, name: 'Second Late Fee', type: 'percent', amount: 10 },
];

// Lien/past-due process. Each step fires once per delinquency when days-late reaches `day`.
export const DEFAULT_LIEN_STEPS = [
  { key: 'reminder', day: 3, name: 'Payment Reminder', template: 'payment_reminder', channel: 'sms', fee: 0 },
  { key: 'late_notice', day: 6, name: 'Late Notice', template: 'late_notice', channel: 'email', fee: 0 },
  { key: 'overlock', day: 15, name: 'Overlock Unit', template: 'overlock_notice', channel: 'letter', fee: 0, overlock: true },
  { key: 'pre_lien', day: 30, name: 'Pre-Lien Notice', template: 'pre_lien', channel: 'letter', fee: 15 },
  { key: 'lien', day: 45, name: 'Lien Notice (Certified Mail)', template: 'lien_notice', channel: 'letter', fee: 25, certified: true },
  { key: 'advertise', day: 60, name: 'Advertise Sale', template: 'auction_ad', channel: 'letter', fee: 35 },
  { key: 'auction', day: 75, name: 'Schedule Auction', template: 'auction_scheduled', channel: 'letter', fee: 0, auction: true },
];

export const DEFAULT_AUDIT_TEMPLATE = [
  { category: 'Curb Appeal & Grounds', items: ['Signage clean and lit', 'Landscaping maintained', 'Parking lot / drive aisles clean', 'Fencing & gate in good repair', 'No debris or abandoned items'] },
  { category: 'Office & Retail', items: ['Office clean and organized', 'Merchandise stocked and faced', 'Pricing / promotions displayed', 'Manager in uniform & professional'] },
  { category: 'Units & Buildings', items: ['Vacant units clean and swept', 'Vacant units unlocked (or company lock)', 'Hallways clear, lights working', 'Overlocks match past-due list', 'No pest / leak issues'] },
  { category: 'Paperwork & Compliance', items: ['Lease files complete', 'Lien notices sent on schedule', 'Auction files complete', 'Walkthrough log current'] },
  { category: 'Cash Handling & Sales', items: ['Daily closes completed & balanced', 'Deposits made timely', 'Leads followed up within 24 hrs', 'Phone answered professionally (mystery shop)'] },
];

export const PERMISSIONS = [
  ['dashboard.view', 'Dashboard', 'View dashboard'],
  ['portfolio.view', 'Dashboard', 'View all-facility portfolio rollup'],
  ['tenants.view', 'Tenants', 'View tenants & accounts'],
  ['tenants.edit', 'Tenants', 'Edit tenant information'],
  ['movein.perform', 'Tenants', 'Perform move-ins'],
  ['moveout.perform', 'Tenants', 'Perform move-outs'],
  ['payments.take', 'Accounting', 'Take payments'],
  ['payments.refund', 'Accounting', 'Refund / void payments'],
  ['ledger.adjust', 'Accounting', 'Waive fees / post credits & charges'],
  ['dailyclose.perform', 'Accounting', 'Perform daily close'],
  ['units.view', 'Units', 'View units & site map'],
  ['units.manage', 'Units', 'Add / edit units, set unrentable'],
  ['walkthrough.view', 'Units', 'Print walkthrough / lock check'],
  ['gate.manage', 'Units', 'Manage gate access codes'],
  ['pastdue.manage', 'Collections', 'Manage past dues & lien steps'],
  ['auctions.manage', 'Collections', 'Manage auctions'],
  ['leads.manage', 'Sales', 'Manage leads & reservations'],
  ['rates.manage', 'Sales', 'Manage street rates, rent increases & promotions'],
  ['merch.sell', 'Retail', 'Sell merchandise'],
  ['inventory.manage', 'Retail', 'Manage inventory'],
  ['communications.send', 'Communications', 'Send communications'],
  ['templates.manage', 'Communications', 'Manage message templates'],
  ['reports.view', 'Reports', 'View reports'],
  ['tasks.manage', 'Reminders', 'Create & assign reminders'],
  ['audits.view', 'Audits', 'View property audits'],
  ['audits.perform', 'Audits', 'Perform property audits'],
  ['audits.respond', 'Audits', 'Respond to / acknowledge audits'],
  ['activity.view', 'Admin', 'View activity log'],
  ['settings.facility', 'Admin', 'Edit facility settings, fees & lien schedule'],
  ['settings.users', 'Admin', 'Manage users'],
  ['settings.roles', 'Admin', 'Manage roles & permissions'],
  ['settings.integrations', 'Admin', 'Manage integrations & system tools'],
];
export const ALL_PERMS = PERMISSIONS.map((p) => p[0]);

const without = (...ex) => ALL_PERMS.filter((p) => !ex.includes(p));
export const DEFAULT_ROLES = [
  { slug: 'admin', name: 'Admin', rank: 100, description: 'Full access to every facility and setting', permissions: ALL_PERMS },
  { slug: 'dm', name: 'District Manager', rank: 80, description: 'Oversees a group of facilities; performs monthly audits',
    permissions: without('settings.roles', 'settings.integrations') },
  { slug: 'am', name: 'Area Manager', rank: 60, description: 'Supports district manager; audits and coaching',
    permissions: without('settings.roles', 'settings.integrations', 'settings.users') },
  { slug: 'pm', name: 'Property Manager', rank: 40, description: 'Runs day-to-day operations of a facility',
    permissions: without('portfolio.view', 'audits.perform', 'settings.roles', 'settings.integrations', 'settings.users', 'payments.refund') },
  { slug: 'asst', name: 'Assistant Manager', rank: 20, description: 'Front-desk operations',
    permissions: ['dashboard.view', 'tenants.view', 'tenants.edit', 'movein.perform', 'moveout.perform', 'payments.take', 'dailyclose.perform',
      'units.view', 'walkthrough.view', 'gate.manage', 'pastdue.manage', 'leads.manage', 'merch.sell', 'communications.send', 'tasks.manage', 'audits.view'] },
];

export const DEFAULT_TEMPLATES = [
  { key: 'welcome', name: 'Welcome / Move-In Confirmation', channel: 'email', category: 'Move-In', subject: 'Welcome to {{facility_name}}!',
    body: 'Hi {{first_name}},\n\nWelcome to {{facility_name}}! You are all set in unit {{unit}}.\n\nYour gate code is {{gate_code}}. Gate hours: {{gate_hours}}.\nYour monthly rent of {{rent}} is due on the {{due_day}} of each month.\n\nCall us any time at {{facility_phone}}.\n\nThank you,\n{{facility_name}}' },
  { key: 'payment_reminder', name: 'Payment Reminder', channel: 'sms', category: 'Collections', subject: 'Payment reminder',
    body: '{{facility_name}}: Hi {{first_name}}, your balance of {{balance}} for unit {{unit}} is past due. Pay now to avoid late fees. Questions? {{facility_phone}}' },
  { key: 'late_notice', name: 'Late Notice', channel: 'email', category: 'Collections', subject: 'Your account is past due - {{facility_name}}',
    body: 'Dear {{first_name}} {{last_name}},\n\nOur records show your account for unit {{unit}} is {{days_late}} days past due with a balance of {{balance}}.\n\nLate fees have been or will be applied per your rental agreement. Gate access will be suspended at {{gate_deny_days}} days past due.\n\nPlease make a payment as soon as possible by calling {{facility_phone}} or visiting the office.\n\nSincerely,\n{{facility_name}} Management' },
  { key: 'overlock_notice', name: 'Overlock Notice', channel: 'letter', category: 'Collections', subject: 'Notice of Overlock',
    body: 'Dear {{first_name}} {{last_name}},\n\nBecause your account for unit {{unit}} is {{days_late}} days past due (balance {{balance}}), your unit has been overlocked and access has been denied as permitted by your rental agreement.\n\nTo regain access, please pay your balance in full.\n\n{{facility_name}}\n{{facility_address}}\n{{facility_phone}}' },
  { key: 'pre_lien', name: 'Pre-Lien Notice', channel: 'letter', category: 'Collections', subject: 'Pre-Lien Notice',
    body: 'PRE-LIEN NOTICE\n\nDate: {{today}}\nTo: {{first_name}} {{last_name}}\n{{tenant_address}}\n\nRe: Unit {{unit}} at {{facility_name}}\n\nYou are hereby notified that your account is {{days_late}} days in default with a balance of {{balance}}. If the balance is not paid, a lien notice will be issued and your stored property may be sold to satisfy the owner\'s lien as permitted by state law.\n\n{{facility_name}}\n{{facility_address}}' },
  { key: 'lien_notice', name: 'Lien Notice (Certified)', channel: 'letter', category: 'Collections', subject: 'Notice of Lien and Sale',
    body: 'NOTICE OF LIEN AND PROPOSED SALE\nSENT VIA CERTIFIED MAIL\n\nDate: {{today}}\nOccupant: {{first_name}} {{last_name}}\n{{tenant_address}}\n\nThe owner, {{facility_name}}, claims a lien on all personal property stored in unit {{unit}} for the sum of {{balance}}, which is due and unpaid.\n\nUnless the claim is paid in full, the property will be advertised and sold at public auction on or after a date no sooner than allowed by state law.\n\n{{facility_name}}\n{{facility_address}} | {{facility_phone}}' },
  { key: 'auction_ad', name: 'Notice of Sale Advertisement', channel: 'letter', category: 'Collections', subject: 'Notice of Public Sale',
    body: 'NOTICE OF PUBLIC SALE: {{facility_name}}, {{facility_address}}, will sell the contents of unit {{unit}} ({{first_name}} {{last_name}}) to satisfy a lien. Sale to be conducted online. Contents: household goods, furniture, boxes, misc.' },
  { key: 'auction_scheduled', name: 'Auction Scheduled', channel: 'letter', category: 'Collections', subject: 'Auction Date Scheduled',
    body: 'Dear {{first_name}} {{last_name}},\n\nThe contents of unit {{unit}} are scheduled to be sold at auction. Your balance due is {{balance}}. You may redeem your property by paying the full balance before the sale.\n\n{{facility_name}} | {{facility_phone}}' },
  { key: 'rent_increase', name: 'Rent Increase Notice', channel: 'letter', category: 'Rates', subject: 'Notice of Rental Rate Change',
    body: 'Dear {{first_name}} {{last_name}},\n\nThank you for being a valued customer at {{facility_name}}. Due to rising operating costs, the monthly rent for unit {{unit}} will change from {{old_rent}} to {{new_rent}} effective {{effective_date}}.\n\nIf you have any questions, please contact us at {{facility_phone}}.\n\nSincerely,\n{{facility_name}} Management' },
  { key: 'reservation', name: 'Reservation Confirmation', channel: 'email', category: 'Leads', subject: 'Your unit is reserved at {{facility_name}}',
    body: 'Hi {{first_name}},\n\nGreat news - we are holding a {{unit_size}} unit for you until {{reservation_expires}} at {{quoted_rate}}/month.\n\nBring a photo ID when you come in to sign your lease.\n\n{{facility_name}} | {{facility_phone}}' },
  { key: 'lead_followup', name: 'Lead Follow-Up', channel: 'sms', category: 'Leads', subject: 'Following up',
    body: 'Hi {{first_name}}, this is {{facility_name}} following up on your storage inquiry. We still have units available - reply or call {{facility_phone}} to reserve!' },
  { key: 'payment_receipt', name: 'Payment Receipt', channel: 'email', category: 'Accounting', subject: 'Payment received - thank you!',
    body: 'Hi {{first_name}},\n\nWe received your payment. Your current balance is {{balance}}.\n\nThank you,\n{{facility_name}}' },
  { key: 'move_out', name: 'Move-Out Confirmation', channel: 'email', category: 'Move-Out', subject: 'Move-out confirmation',
    body: 'Hi {{first_name}},\n\nThis confirms you have vacated unit {{unit}} at {{facility_name}}. Thank you for your business - we hope to see you again!\n\n{{facility_name}}' },
  { key: 'general', name: 'General Announcement', channel: 'email', category: 'General', subject: 'A message from {{facility_name}}',
    body: 'Hi {{first_name}},\n\n[Your message here]\n\n{{facility_name}} | {{facility_phone}}' },
];
