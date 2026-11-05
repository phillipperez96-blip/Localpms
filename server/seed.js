// Generates realistic demo data: 3 facilities, ~750 units, tenants with ledger history,
// past dues at every lien stage, leads, merchandise, audits, reminders and more.
import { all, get, run, insert, update, tx, resetDatabase, setState } from './db.js';
import { hashPassword } from './auth.js';
import { processFacility, postLedger, logActivity, generateGateCode, sendTemplate } from './core.js';
import { today, addDays, addMonths, diffDays, round2, toISO, parse, DEFAULT_LATE_FEES, DEFAULT_LIEN_STEPS, DEFAULT_AUDIT_TEMPLATE, DEFAULT_ROLES, DEFAULT_TEMPLATES } from './util.js';

let seed = 42;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const ri = (a, b) => Math.floor(rand() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

const FIRST = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Chris', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy', 'Anthony', 'Betty', 'Mark', 'Sandra', 'Donald', 'Ashley', 'Steven', 'Kimberly', 'Andrew', 'Emily', 'Joshua', 'Donna', 'Kevin', 'Michelle', 'Brian', 'Carol', 'George', 'Amanda', 'Tim', 'Melissa', 'Ronald', 'Deborah', 'Jason', 'Stephanie', 'Ryan', 'Rebecca', 'Jacob', 'Laura', 'Gary', 'Sharon', 'Nick', 'Cynthia', 'Eric', 'Kathleen', 'Jonathan', 'Amy', 'Luis', 'Maria', 'Carlos', 'Rosa', 'Andre', 'Keisha', 'Wei', 'Priya', 'Omar', 'Fatima', 'Diego', 'Lucia', 'Hector', 'Tanya'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Patel', 'Kim', 'Okafor', 'Shah', 'Murphy', 'Cook', 'Rogers', 'Reed', 'Bailey', 'Bell'];
const STREETS = ['Oak St', 'Maple Ave', 'Cedar Ln', 'Pine Dr', 'Elm St', 'Walnut Way', 'Birch Rd', 'Willow Ct', 'Sunset Blvd', 'Lakeview Dr', 'Hillcrest Rd', 'Park Ave', 'Main St', 'River Rd', 'Meadow Ln'];
const SOURCES = ['Website', 'Phone Call', 'Walk-In', 'Google', 'SpareFoot', 'Referral', 'Drive-By', 'Facebook'];

const FACILITIES = [
  { name: 'Riverside Self Storage', code: 'RSS', address: '1200 River Bend Rd', city: 'Austin', state: 'TX', zip: '78741', phone: '(512) 555-0142', email: 'riverside@demo-storage.com', mult: 1.08, occ: 0.91, billing_type: 'anniversary',
    buildings: [['A', 'Climate Controlled', 'Interior', [[5, 5, 18], [5, 10, 26], [10, 10, 26], [10, 15, 12], [10, 20, 6]]], ['B', 'Drive-Up', 'Roll-Up', [[5, 10, 12], [10, 10, 22], [10, 15, 18]]], ['C', 'Drive-Up', 'Roll-Up', [[10, 10, 16], [10, 15, 16], [10, 20, 16], [10, 30, 8]]], ['D', 'Drive-Up', 'Roll-Up', [[10, 20, 14], [10, 30, 8]]], ['P', 'Parking', 'Open', [[10, 20, 14], [12, 40, 10]]]] },
  { name: 'Oak Hill Storage Center', code: 'OHS', address: '845 Oak Hill Pkwy', city: 'Round Rock', state: 'TX', zip: '78664', phone: '(512) 555-0187', email: 'oakhill@demo-storage.com', mult: 0.97, occ: 0.86, billing_type: 'first',
    buildings: [['A', 'Climate Controlled', 'Interior', [[5, 5, 14], [5, 10, 22], [10, 10, 22], [10, 15, 10]]], ['B', 'Climate Controlled', 'Interior', [[5, 10, 14], [10, 10, 18], [10, 20, 8]]], ['C', 'Drive-Up', 'Roll-Up', [[10, 10, 18], [10, 15, 18], [10, 20, 14]]], ['D', 'Drive-Up', 'Roll-Up', [[10, 15, 12], [10, 20, 12], [10, 30, 8]]]] },
  { name: 'Lakeside Storage', code: 'LKS', address: '3301 Lakeshore Dr', city: 'Georgetown', state: 'TX', zip: '78628', phone: '(512) 555-0110', email: 'lakeside@demo-storage.com', mult: 0.92, occ: 0.79, billing_type: 'anniversary',
    buildings: [['A', 'Climate Controlled', 'Interior', [[5, 5, 12], [5, 10, 18], [10, 10, 18], [10, 15, 8]]], ['B', 'Drive-Up', 'Roll-Up', [[5, 10, 10], [10, 10, 20], [10, 15, 16], [10, 20, 12]]], ['C', 'Drive-Up', 'Roll-Up', [[10, 20, 12], [10, 30, 10]]], ['P', 'Parking', 'Open', [[10, 20, 16], [12, 40, 14]]]] },
];
const RATES = {
  'Climate Controlled': { '5x5': 59, '5x10': 89, '10x10': 149, '10x15': 189, '10x20': 239 },
  'Drive-Up': { '5x10': 69, '10x10': 119, '10x15': 149, '10x20': 189, '10x30': 259 },
  'Parking': { '10x20': 79, '12x40': 139 },
};
const PRODUCTS = [
  ['LK-DISC', 'Disc Lock', 'Locks', 14.99, 5.5, 40], ['LK-CYL', 'Cylinder Lock', 'Locks', 24.99, 9, 15], ['LK-PAD', 'Padlock (Keyed)', 'Locks', 9.99, 3.2, 25],
  ['BX-SM', 'Small Box', 'Boxes', 2.49, 0.8, 120], ['BX-MD', 'Medium Box', 'Boxes', 3.49, 1.1, 150], ['BX-LG', 'Large Box', 'Boxes', 4.49, 1.5, 90],
  ['BX-WD', 'Wardrobe Box', 'Boxes', 14.99, 5, 18], ['BX-DSH', 'Dish Pack Box', 'Boxes', 7.99, 2.6, 4], ['TP-RL', 'Packing Tape', 'Supplies', 4.99, 1.4, 60],
  ['TP-GUN', 'Tape Gun w/ Tape', 'Supplies', 12.99, 4.2, 12], ['BW-12', 'Bubble Wrap 12"x30\'', 'Supplies', 9.99, 3.4, 22], ['PP-PK', 'Packing Paper (5 lb)', 'Supplies', 11.99, 4, 3],
  ['MC-Q', 'Mattress Cover - Queen', 'Covers', 8.99, 2.5, 20], ['MC-K', 'Mattress Cover - King', 'Covers', 9.99, 2.8, 2], ['SC-CV', 'Sofa Cover', 'Covers', 12.99, 3.9, 10],
  ['FP-PAD', 'Furniture Pad', 'Supplies', 11.99, 4.5, 24], ['ST-WRP', 'Stretch Wrap', 'Supplies', 19.99, 7, 8], ['DH-ABS', 'Moisture Absorber', 'Supplies', 6.99, 2.1, 30],
];

function hash() { return hashPassword('demo123'); }

export async function seedDatabase() {
  resetDatabase();
  const T = today();
  console.log('Seeding demo data as of', T);

  // roles & users
  const roleIds = {};
  for (const r of DEFAULT_ROLES) roleIds[r.slug] = insert('roles', { name: r.name, slug: r.slug, description: r.description, permissions: r.permissions, rank: r.rank });

  for (const t of DEFAULT_TEMPLATES) insert('templates', t);
  insert('insurance_plans', { name: 'Basic Protection', coverage: 2000, premium: 12 });
  insert('insurance_plans', { name: 'Standard Protection', coverage: 3000, premium: 15 });
  insert('insurance_plans', { name: 'Premium Protection', coverage: 5000, premium: 22 });

  const facIds = [];
  for (const F of FACILITIES) {
    const fid = insert('facilities', {
      name: F.name, code: F.code, address: F.address, city: F.city, state: F.state, zip: F.zip, phone: F.phone, email: F.email,
      office_hours: 'Mon–Fri 9:30am–6pm, Sat 9am–5pm, Sun Closed', gate_hours: '6:00am – 10:00pm daily',
      billing_type: F.billing_type, prorate: 1, tax_rate: 0.0825, admin_fee: 25, deposit: 0, gate_deny_days: 6, lien_automation: 'auto', reservation_days: 7,
      late_fees: DEFAULT_LATE_FEES, lien_steps: DEFAULT_LIEN_STEPS, audit_template: DEFAULT_AUDIT_TEMPLATE,
    });
    facIds.push(fid);
    insert('promotions', { facility_id: fid, name: 'First Month $1', description: 'Pay just $1 for the first month', discount_type: 'fixed_price', value: 1, months: 1 });
    insert('promotions', { facility_id: fid, name: '50% Off First Month', description: 'Half off first month rent', discount_type: 'percent', value: 50, months: 1 });
    insert('promotions', { facility_id: fid, name: '$20 Off 3 Months', description: '$20 off monthly rent for 3 months', discount_type: 'amount_off', value: 20, months: 3 });
  }

  const users = [
    ['Alex Morgan', 'admin@demo.com', 'admin', '*'], ['Jordan Lee', 'dm@demo.com', 'dm', '*'], ['Casey Rivera', 'am@demo.com', 'am', [facIds[0], facIds[1]]],
    ['Taylor Brooks', 'pm@demo.com', 'pm', [facIds[0]]], ['Riley Chen', 'pm2@demo.com', 'pm', [facIds[1]]], ['Sam Patel', 'pm3@demo.com', 'pm', [facIds[2]]],
    ['Morgan Diaz', 'asst@demo.com', 'asst', [facIds[0]]],
  ];
  const uid = {};
  const pw = hash();
  for (const [name, email, role, fac] of users) uid[email] = insert('users', { name, email, phone: `(512) 555-01${ri(10, 99)}`, password_hash: pw, role_id: roleIds[role], facility_ids: fac === '*' ? '*' : JSON.stringify(fac) });
  const pmFor = { [facIds[0]]: uid['pm@demo.com'], [facIds[1]]: uid['pm2@demo.com'], [facIds[2]]: uid['pm3@demo.com'] };

  for (let fi = 0; fi < FACILITIES.length; fi++) {
    const F = FACILITIES[fi], fid = facIds[fi], pm = pmFor[fid];
    const promos = all('SELECT * FROM promotions WHERE facility_id=?', fid);
    tx(() => {
      // ---- units & site map
      let y = 0;
      const units = [];
      for (const [b, type, door, mix] of F.buildings) {
        const list = [];
        for (const [w, l, n] of mix) for (let i = 0; i < n; i++) list.push([w, l]);
        const half = Math.ceil(list.length / 2);
        const rows = [list.slice(0, half), list.slice(half)];
        let num = 1, rowY = y;
        for (const row of rows) {
          let x = 0;
          const h = Math.max(...row.map((u) => u[1]));
          for (const [w, l] of row) {
            const size = `${w}x${l}`;
            const rate = Math.round((RATES[type][size] || 99) * F.mult);
            const number = `${b}${String(num++).padStart(3, '0')}`;
            const id = insert('units', { facility_id: fid, number, building: b, unit_type: type, width: w, length: l, sqft: w * l, floor: 1, door_type: door, street_rate: rate, status: 'vacant',
              features: type === 'Climate Controlled' ? 'Climate Controlled, Interior Access' : type === 'Parking' ? 'Uncovered' : 'Drive-Up Access', map_x: x, map_y: rowY + (row === rows[1] ? 0 : h - l), map_w: w, map_h: l });
            units.push({ id, number, rate, type, size, w, l });
            x += w;
          }
          rowY += h;
        }
        y = rowY + 22;
      }
      // a couple of unrentable units
      for (let i = 0; i < 2; i++) { const u = pick(units); u.unrentable = true; update('units', u.id, { status: 'unrentable', unrentable_reason: pick(['Roof leak – repair scheduled', 'Door damaged', 'Being used as company storage']) }); }

      // ---- rentals
      const histStart = addMonths(T, -18);
      const rentable = units.filter((u) => !u.unrentable);
      const occCount = Math.round(rentable.length * F.occ);
      const shuffled = [...rentable].sort(() => rand() - 0.5);
      const occupied = shuffled.slice(0, occCount);
      const vacantPool = shuffled.slice(occCount);

      const makeTenant = (moveIn) => {
        const first = pick(FIRST), last = pick(LAST);
        return insert('tenants', {
          facility_id: fid, first_name: first, last_name: last, company: chance(0.06) ? `${last} ${pick(['Construction', 'Realty', 'Landscaping', 'Designs', 'LLC'])}` : null,
          email: `${first}.${last}${ri(1, 99)}@example.com`.toLowerCase(), phone: `(512) 555-${String(ri(1000, 9999))}`,
          address: `${ri(100, 9999)} ${pick(STREETS)}`, city: pick(['Austin', 'Round Rock', 'Pflugerville', 'Georgetown', 'Cedar Park', 'Leander']), state: 'TX', zip: String(ri(78610, 78759)),
          dl_number: String(ri(10000000, 49999999)), dl_state: 'TX', dob: `${ri(1950, 2002)}-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`,
          emergency_name: `${pick(FIRST)} ${last}`, emergency_phone: `(512) 555-${String(ri(1000, 9999))}`, military: chance(0.07) ? 1 : 0,
          gate_code: generateGateCode(), gate_access: 'auto', autopay: chance(0.35) ? 1 : 0, autopay_method: 'Visa •••• ' + ri(1000, 9999),
          status: 'active', created_at: moveIn + ' 10:00:00',
        });
      };

      const createRental = (u, moveIn, moveOut, profile) => {
        const tid = makeTenant(moveIn);
        const tenureMonths = diffDays(T, moveIn) / 30.4;
        let rent = u.rate;
        if (tenureMonths > 14) rent = Math.round(u.rate * (0.78 + rand() * 0.14));
        else if (tenureMonths > 6) rent = Math.round(u.rate * (0.9 + rand() * 0.1));
        const ins = chance(0.62) ? pick([[1, 12], [2, 15], [3, 22]]) : null;
        const promo = tenureMonths < 6 && chance(0.4) ? pick(promos) : null;
        const anchor = F.billing_type === 'first' ? 1 : parse(moveIn).getDate();
        const rid = insert('rentals', { facility_id: fid, tenant_id: tid, unit_id: u.id, move_in_date: moveIn, move_out_date: moveOut, rent, insurance_plan_id: ins?.[0], insurance_premium: ins?.[1] || 0,
          promotion_id: promo?.id, status: moveOut ? 'ended' : 'active', lien_status: 'current', created_at: moveIn });
        // ledger: move-in
        postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: moveIn, type: 'charge', category: 'admin_fee', description: 'Admin fee', amount: 25 });
        let first = rent;
        if (promo) first = promo.discount_type === 'fixed_price' ? 1 : promo.discount_type === 'percent' ? round2(rent / 2) : rent - 20;
        let due;
        if (F.billing_type === 'first') {
          const d = parse(moveIn), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
          if (d.getDate() !== 1) first = round2(first * (dim - d.getDate() + 1) / dim);
          due = addMonths(moveIn.slice(0, 8) + '01', 1, 1);
        } else due = addMonths(moveIn, 1);
        postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: moveIn, type: 'charge', category: 'rent', description: `Rent ${u.number} (move-in)`, amount: first, reference: `RENT:${rid}:${moveIn}` });
        if (ins) postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: moveIn, type: 'charge', category: 'insurance', description: `Protection plan ${u.number}`, amount: ins[1] });
        const mi = round2(25 + first + (ins?.[1] || 0));
        if (moveIn >= histStart) postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: moveIn, type: 'payment', category: 'payment', description: 'Move-in payment', amount: mi, method: pick(['card', 'card', 'card', 'cash', 'check']), reference: 'MI', user_id: pm });
        else postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: moveIn, type: 'payment', category: 'payment', description: 'Balance forward', amount: mi, method: 'other', reference: 'CONV' });

        // recurring charges
        const end = moveOut || T;
        const dues = [];
        let guard = 0;
        while (due <= end && guard++ < 400) { dues.push(due); due = addMonths(due, 1, anchor); }
        const unpaidN = moveOut ? 0 : profile;
        const paidDues = dues.slice(0, dues.length - unpaidN);
        for (const d of dues) {
          if (d < histStart) continue;
          let amt = rent;
          postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: d, type: 'charge', category: 'rent', description: `Rent ${u.number} (${d})`, amount: amt, reference: `RENT:${rid}:${d}` });
          if (ins) postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: d, type: 'charge', category: 'insurance', description: `Protection plan ${u.number}`, amount: ins[1], reference: `INS:${rid}:${d}` });
          if (paidDues.includes(d)) {
            const payDate = addDays(d, chance(0.8) ? -ri(0, 4) : ri(1, 9));
            const pd = payDate > T ? T : payDate;
            postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: pd, type: 'payment', category: 'payment', description: 'Payment', amount: amt + (ins?.[1] || 0), method: pick(['card', 'card', 'card', 'ach', 'cash', 'check']), reference: 'PMT', user_id: chance(0.5) ? pm : null });
          }
        }
        // historical older dues before histStart treated as paid (balance forward)
        update('rentals', rid, { next_due_date: due });
        if (moveOut) {
          update('tenants', tid, { status: 'former', gate_access: 'auto' });
          update('rentals', rid, { move_out_reason: pick(['Moved out of area', 'No longer needed', 'Bought a house', 'Downsized', 'Price']), vacate_notes: 'Unit broom clean, lock removed.' });
        } else update('units', u.id, { status: 'occupied' });
        return { tid, rid };
      };

      // occupied units
      for (const u of occupied) {
        const r = rand();
        let moveIn;
        const dom = parse(T).getDate() - 1;
        if (r < 0.022) moveIn = addDays(T, -ri(0, dom));
        else if (r < 0.045) moveIn = addDays(T, -ri(0, 30));
        else if (r < 0.32) moveIn = addDays(T, -ri(31, 365));
        else if (r < 0.6) moveIn = addDays(T, -ri(366, 900));
        else moveIn = addDays(T, -ri(541, 2400));
        const p = rand();
        const profile = moveIn > addDays(T, -35) ? 0 : p < 0.86 ? 0 : p < 0.935 ? 1 : p < 0.965 ? 2 : p < 0.985 ? 3 : 4;
        createRental(u, moveIn, null, profile);
        u.freeBefore = moveIn;
      }
      // prior tenants: every unit had someone before the current occupant (keeps historical occupancy realistic)
      let recentOuts = ri(2, 4);
      for (const u of [...occupied, ...vacantPool]) {
        let before = u.freeBefore || T;
        if (!u.freeBefore && recentOuts > 0 && parse(T).getDate() > 1) {
          recentOuts--;
          const mo = addDays(T, -ri(0, parse(T).getDate() - 1));
          const mi = addDays(mo, -ri(90, 800));
          createRental(u, mi, mo, 0);
          before = mi;
        }
        if (!u.freeBefore && !chance(0.6)) continue;
        for (let k = 0; k < 3 && before > addDays(T, -420); k++) {
          const moveOut = addDays(before, -ri(u.freeBefore || k ? 10 : 1, u.freeBefore || k ? 110 : 330));
          const moveIn = addDays(moveOut, -ri(90, 800));
          createRental(u, moveIn, moveOut, 0);
          before = moveIn;
        }
      }
    });

    // late fees + lien steps via the real engine (messages logged, not delivered)
    const stats = await processFacility(fid, T, { deliver: false });
    console.log(`  ${F.name}: lien steps ${stats.lienSteps}, late fees ${stats.lateFees}`);

    // overlocked unit that has since paid (shows up on "remove overlock" list)
    const paidOver = get(`SELECT r.unit_id FROM rentals r WHERE r.facility_id=? AND r.status='active' AND r.lien_status='current' ORDER BY r.id DESC LIMIT 1`, fid);
    if (paidOver) update('units', paidOver.unit_id, { overlocked: 1 });

    tx(() => {
      // ---- completed auctions (historical)
      for (let i = 0; i < 3; i++) {
        const u = get("SELECT * FROM units WHERE facility_id=? AND status='vacant' ORDER BY RANDOM() LIMIT 1", fid);
        if (!u) break;
        const d = addDays(T, -ri(20, 200));
        const tid = insert('tenants', { facility_id: fid, first_name: pick(FIRST), last_name: pick(LAST), phone: `(512) 555-${ri(1000, 9999)}`, email: `former${ri(100, 999)}@example.com`, status: 'former', gate_code: generateGateCode(), address: `${ri(100, 9999)} ${pick(STREETS)}`, city: 'Austin', state: 'TX', zip: '78745' });
        const owed = ri(380, 900);
        const rid = insert('rentals', { facility_id: fid, tenant_id: tid, unit_id: u.id, move_in_date: addDays(d, -ri(200, 500)), move_out_date: d, rent: u.street_rate, status: 'ended', lien_status: 'sold', move_out_reason: 'Auctioned' });
        const sale = ri(150, 1400);
        const applied = Math.min(sale, owed);
        postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: addDays(d, -80), type: 'charge', category: 'rent', description: 'Unpaid rent & fees', amount: owed });
        postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: d, type: 'payment', category: 'auction', description: 'Auction proceeds applied', amount: applied, method: 'auction' });
        if (owed > applied) postLedger({ facility_id: fid, tenant_id: tid, rental_id: rid, date: d, type: 'credit', category: 'write_off', description: 'Bad debt write-off', amount: owed - applied });
        insert('auctions', { facility_id: fid, rental_id: rid, tenant_id: tid, unit_id: u.id, scheduled_date: d, platform: pick(['StorageTreasures', 'Lockerfox', 'Live Auction']), status: 'sold', winning_bidder: `${pick(FIRST)} ${pick(LAST)}`, bidder_phone: `(512) 555-${ri(1000, 9999)}`, sale_amount: sale, applied_to_balance: applied, surplus: Math.max(0, sale - owed), cleanout_deadline: addDays(d, 3), notes: 'Unit cleaned out by buyer.' });
      }

      // ---- leads
      const vac = all("SELECT * FROM units WHERE facility_id=? AND status='vacant'", fid);
      for (let i = 0; i < ri(16, 24); i++) {
        const st = pick(['new', 'new', 'new', 'contacted', 'contacted', 'reserved', 'reserved', 'converted', 'lost']);
        const u = st === 'reserved' && vac.length ? vac.splice(ri(0, vac.length - 1), 1)[0] : null;
        const created = addDays(T, -ri(0, 25));
        const f = pick(FIRST), l = pick(LAST);
        insert('leads', { facility_id: fid, first_name: f, last_name: l, phone: `(512) 555-${ri(1000, 9999)}`, email: `${f}.${l}@example.com`.toLowerCase(), source: pick(SOURCES),
          unit_type: pick(['Climate Controlled', 'Drive-Up', 'Parking']), size_wanted: pick(['5x5', '5x10', '10x10', '10x15', '10x20', '10x30']), desired_date: addDays(T, ri(-2, 21)), status: st,
          unit_id: u?.id, reservation_expires: u ? addDays(T, ri(1, 7)) : null, quoted_rate: u?.street_rate || null, follow_up_date: ['new', 'contacted'].includes(st) ? addDays(T, ri(-2, 5)) : null,
          lost_reason: st === 'lost' ? pick(['Price too high', 'Went with competitor', 'No longer needed', 'Unit size unavailable']) : null,
          notes: pick(['Moving from out of state', 'Needs storage during home remodel', 'Downsizing, asked about climate control', 'Wants to store a boat', 'Business inventory', 'College student, summer storage']), assigned_to: pm, created_at: created + ' 11:00:00' });
        if (u) update('units', u.id, { status: 'reserved' });
      }

      // ---- merchandise
      for (const [sku, name, cat, price, cost, qty] of PRODUCTS) insert('products', { facility_id: fid, sku, name, category: cat, price, cost, qty_on_hand: Math.max(0, qty + ri(-10, 10)), reorder_point: cat === 'Boxes' ? 20 : 6, taxable: 1 });
      const prods = all('SELECT * FROM products WHERE facility_id=?', fid);
      const tens = all("SELECT id, first_name, last_name FROM tenants WHERE facility_id=? AND status='active'", fid);
      for (let i = 0; i < 70; i++) {
        const d = addDays(T, -ri(0, 60));
        const items = Array.from({ length: ri(1, 3) }, () => ({ p: pick(prods), q: ri(1, 6) }));
        const sub = round2(items.reduce((s, it) => s + it.p.price * it.q, 0));
        const tax = round2(sub * 0.0825), total = round2(sub + tax);
        const t = chance(0.55) ? pick(tens) : null;
        const method = pick(['cash', 'card', 'card']);
        const sid = insert('sales', { facility_id: fid, tenant_id: t?.id, customer_name: t ? `${t.first_name} ${t.last_name}` : 'Walk-in Customer', subtotal: sub, tax, total, method, user_id: pm, date: d, created_at: d + ' 12:00:00' });
        for (const it of items) insert('sale_items', { sale_id: sid, product_id: it.p.id, name: it.p.name, qty: it.q, price: it.p.price });
        postLedger({ facility_id: fid, tenant_id: t?.id, date: d, type: 'charge', category: 'merchandise', description: `Merchandise sale #${sid}`, amount: total, sale_id: sid });
        postLedger({ facility_id: fid, tenant_id: t?.id, date: d, type: 'payment', category: 'payment', description: `Payment – sale #${sid}`, amount: total, method, sale_id: sid, user_id: pm });
      }

      // ---- daily closes for last 30 days
      for (let i = 30; i >= 1; i--) {
        const d = addDays(T, -i);
        const sums = Object.fromEntries(all("SELECT method, SUM(amount) s FROM ledger WHERE facility_id=? AND date=? AND type='payment' AND voided=0 GROUP BY method", fid, d).map((r) => [r.method, round2(r.s)]));
        const cash = sums.cash || 0, check = sums.check || 0;
        const counted = chance(0.1) ? round2(cash - ri(1, 20)) : cash;
        insert('daily_closes', { facility_id: fid, date: d, expected_cash: cash, counted_cash: counted, expected_check: check, counted_check: check, card_total: sums.card || 0, ach_total: sums.ach || 0, other_total: 0,
          total: round2(Object.values(sums).reduce((a, b) => a + b, 0)), variance: round2(counted - cash), deposit_ref: `DEP-${d.replace(/-/g, '')}`, notes: counted !== cash ? 'Short – recounted, see note in safe log' : '', user_id: pm, created_at: d + ' 18:05:00' });
      }

      // ---- audits (last 5 months + current month status varies)
      const tpl = DEFAULT_AUDIT_TEMPLATE;
      const auditor = uid['dm@demo.com'];
      for (let m = 5; m >= 0; m--) {
        if (m === 0 && fi === 2) break; // Lakeside not visited yet this month
        const visit = addDays(addMonths(T.slice(0, 8) + '01', -m), ri(2, 14) > diffDays(T, T.slice(0, 8) + '01') && m === 0 ? 0 : ri(2, 14));
        const status = m === 0 && fi === 1 ? 'draft' : m === 0 ? 'submitted' : 'acknowledged';
        const aid = insert('audits', { facility_id: fid, auditor_id: auditor, visit_date: visit > T ? T : visit, period: (visit > T ? T : visit).slice(0, 7), status,
          summary: pick(['Overall a solid visit. Keep focus on collections and get the vacant units in B building swept.', 'Property looks great. Merchandise wall needs restocking. Good job on lead follow-up.', 'Several overlocks did not match the past-due list – please do a full lock check this week.', 'Curb appeal improved since last visit. Need to tighten up daily close variances.']),
          manager_response: status === 'acknowledged' ? pick(['Thanks – completed lock check on Tuesday.', 'Restocked boxes and locks, order placed for covers.', 'Understood, will address by end of week.']) : null,
          acknowledged_by: status === 'acknowledged' ? pm : null, acknowledged_at: status === 'acknowledged' ? addDays(visit, 2) + ' 09:00:00' : null, created_at: visit + ' 10:00:00' });
        let score = 0, max = 0, sort = 0;
        for (const c of tpl) for (const label of c.items) {
          const pts = status === 'draft' && chance(0.4) ? null : chance(0.82) ? 5 : ri(1, 4);
          max += 5; score += pts || 0;
          insert('audit_items', { audit_id: aid, category: c.category, label, max_points: 5, points: pts, notes: pts !== null && pts < 4 ? pick(['Needs attention', 'Fix before next visit', 'Discussed with manager']) : null, sort: sort++ });
          if (m === 0 && pts !== null && pts < 3 && status !== 'draft') insert('tasks', { facility_id: fid, title: `Audit follow-up: ${label}`, description: 'Flagged during monthly audit', due_date: addDays(T, ri(1, 10)), priority: 'high', status: 'open', category: 'Audit', assigned_to: pm, created_by: auditor, source: 'audit', audit_id: aid });
        }
        update('audits', aid, { score, max_score: max });
      }

      // ---- tasks / reminders
      const taskList = [['Order more medium boxes', 'Retail', 'normal'], ['Call pest control for quarterly service', 'Maintenance', 'normal'], ['Replace light in Building A hallway', 'Maintenance', 'high'],
        ['Update website photos', 'Marketing', 'low'], ['Lock check – all vacant units', 'Operations', 'high'], ['Follow up with roof contractor', 'Maintenance', 'normal'], ['Post 3 new Google reviews requests', 'Marketing', 'low']];
      for (const [title, cat, pr] of taskList) {
        const done = chance(0.3);
        insert('tasks', { facility_id: fid, title, category: cat, priority: pr, due_date: addDays(T, ri(-4, 12)), status: done ? 'done' : 'open', assigned_to: chance(0.7) ? pm : uid['asst@demo.com'], created_by: chance(0.5) ? uid['dm@demo.com'] : pm, source: 'manual', completed_at: done ? addDays(T, -1) : null, completed_by: done ? pm : null });
      }

      // ---- scheduled rent increases
      const longTen = all("SELECT r.*, u.street_rate FROM rentals r JOIN units u ON u.id=r.unit_id WHERE r.facility_id=? AND r.status='active' AND r.move_in_date<? AND r.rent < u.street_rate*0.85 ORDER BY RANDOM() LIMIT 6", fid, addDays(T, -365));
      for (const r of longTen) insert('rent_increases', { facility_id: fid, rental_id: r.id, tenant_id: r.tenant_id, unit_id: r.unit_id, old_rent: r.rent, new_rent: Math.round(r.rent * 1.09), notice_date: addDays(T, -ri(1, 10)), effective_date: addDays(T, ri(20, 35)), status: 'scheduled', user_id: pm });

      // ---- gate activity
      const active = all("SELECT t.id, t.gate_code, t.gate_last_state, r.unit_id FROM tenants t JOIN rentals r ON r.tenant_id=t.id AND r.status='active' WHERE t.facility_id=?", fid);
      for (let i = 0; i < 120; i++) {
        const t = pick(active);
        const when = new Date(Date.now() - ri(0, 7 * 24 * 60) * 60000);
        const denied = t.gate_last_state === 'denied';
        insert('gate_events', { facility_id: fid, tenant_id: t.id, unit_id: t.unit_id, code: t.gate_code, event: denied ? 'entry_denied' : pick(['entry', 'entry', 'exit']), detail: denied ? 'Code suspended – past due' : 'Keypad', created_at: when.toISOString().replace('T', ' ').slice(0, 19) });
      }
      // activity
      logActivity({ facility_id: fid, user_id: uid['admin@demo.com'], entity_type: 'system', action: 'seed', details: 'Demo data generated' });
    });
    // a few welcome messages for recent move-ins
    for (const t of all("SELECT t.id FROM tenants t JOIN rentals r ON r.tenant_id=t.id WHERE t.facility_id=? AND r.move_in_date>=? LIMIT 8", fid, addDays(T, -20)))
      await sendTemplate('welcome', { tenant_id: t.id, facility_id: fid, user_id: pm, deliver: false });
  }
  setState('last_processed', T);
  console.log('Demo data ready. Sign in with admin@demo.com / demo123');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  await seedDatabase();
}
