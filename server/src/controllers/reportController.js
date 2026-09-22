const db = require('../config/db');

// ─── OVERVIEW KPIs ────────────────────────────────────────────────────────────
exports.getOverview = async (req, res) => {
  try {
    const revenue = await db.query(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE status = 'COMPLETED'`);
    const cogs = await db.query(`
      SELECT COALESCE(SUM(si.quantity * b.buy_price), 0) AS total
      FROM sale_items si
      JOIN batches b ON si.batch_id = b.batch_id
      JOIN sales s ON si.sale_id = s.sale_id
      WHERE s.status = 'COMPLETED'
    `);
    const units = await db.query(`
      SELECT COALESCE(SUM(si.quantity), 0) AS total FROM sale_items si
      JOIN sales s ON si.sale_id = s.sale_id WHERE s.status = 'COMPLETED'
    `);
    const stockVal = await db.query(`
      SELECT COALESCE(SUM(b.stock_quantity * b.sell_price), 0) AS total FROM batches b WHERE b.status != 'INACTIVE'
    `);
    const topMeds = await db.query(`
      SELECT m.generic_name, COALESCE(SUM(si.quantity), 0) AS units_sold
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id
      LEFT JOIN sale_items si ON si.batch_id = b.batch_id
      LEFT JOIN sales s ON si.sale_id = s.sale_id AND s.status = 'COMPLETED'
      GROUP BY m.medicine_id, m.generic_name
      ORDER BY units_sold DESC LIMIT 5
    `);
    const inventoryStatus = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE stock_on_hand > 10) AS healthy,
        COUNT(*) FILTER (WHERE stock_on_hand > 0 AND stock_on_hand <= 10) AS low_stock,
        COUNT(*) FILTER (WHERE stock_on_hand = 0) AS out_of_stock
      FROM (
        SELECT m.medicine_id, COALESCE(SUM(b.stock_quantity), 0) AS stock_on_hand
        FROM medicines m
        LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
        GROUP BY m.medicine_id
      ) x
    `);
    const expiringCount = await db.query(`
      SELECT COUNT(*) AS expiring_soon FROM batches
      WHERE status = 'ACTIVE' AND stock_quantity > 0
      AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
    `);
    const expiredCount = await db.query(`
      SELECT COUNT(*) AS expired FROM batches WHERE expiry_date < CURRENT_DATE AND stock_quantity > 0
    `);

    const totalRevenue = parseFloat(revenue.rows[0].total);
    const totalCOGS = parseFloat(cogs.rows[0].total);
    res.json({
      revenue: totalRevenue,
      gross_profit: totalRevenue - totalCOGS,
      gross_margin: totalRevenue > 0 ? (((totalRevenue - totalCOGS) / totalRevenue) * 100).toFixed(1) : 0,
      units_sold: parseInt(units.rows[0].total),
      stock_value: parseFloat(stockVal.rows[0].total),
      top_medicines: topMeds.rows,
      inventory_status: {
        ...inventoryStatus.rows[0],
        expiring_soon: parseInt(expiringCount.rows[0].expiring_soon),
        expired: parseInt(expiredCount.rows[0].expired)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── SALES TIME SERIES (Day / Week / Month / Year) ────────────────────────────
// Buckets completed sales into a revenue time series for the dashboard and
// reports charts, plus a previous-period comparison so the UI can show growth.
// All amounts are ETB (the pharmacy currency).
exports.getSalesSeries = async (req, res) => {
  try {
    const range = ['day', 'week', 'month', 'year'].includes(String(req.query.range || '').toLowerCase())
      ? String(req.query.range).toLowerCase()
      : 'week';

    const now = new Date();
    const start = new Date();
    const prevStart = new Date();

    if (range === 'day') {
      start.setHours(0, 0, 0, 0);
      prevStart.setDate(prevStart.getDate() - 1);
      prevStart.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
      prevStart.setDate(prevStart.getDate() - 13); prevStart.setHours(0, 0, 0, 0);
    } else if (range === 'month') {
      start.setDate(start.getDate() - 29); start.setHours(0, 0, 0, 0);
      prevStart.setDate(prevStart.getDate() - 59); prevStart.setHours(0, 0, 0, 0);
    } else {
      start.setMonth(start.getMonth() - 11); start.setDate(1); start.setHours(0, 0, 0, 0);
      prevStart.setMonth(prevStart.getMonth() - 23); prevStart.setDate(1); prevStart.setHours(0, 0, 0, 0);
    }

    const bucket = range === 'day' ? 'hour' : range === 'year' ? 'month' : 'day';

    const seriesRes = await db.query(
      `SELECT date_trunc($1, s.sale_date) AS bucket,
              COUNT(*)::int AS transactions,
              COALESCE(SUM(s.total_amount), 0) AS revenue
       FROM sales s
       WHERE s.status = 'COMPLETED' AND s.sale_date >= $2
       GROUP BY 1`,
      [bucket, start.toISOString()]
    );

    const unitsRes = await db.query(
      `SELECT COALESCE(SUM(si.quantity), 0)::int AS units
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.sale_id
       WHERE s.status = 'COMPLETED' AND s.sale_date >= $1`,
      [start.toISOString()]
    );

    const prevRes = await db.query(
      `SELECT COALESCE(SUM(s.total_amount), 0) AS revenue, COUNT(*)::int AS transactions
       FROM sales s
       WHERE s.status = 'COMPLETED' AND s.sale_date >= $1 AND s.sale_date < $2`,
      [prevStart.toISOString(), start.toISOString()]
    );

    /* Build every expected bucket (fills zero-sale periods) */
    const byBucket = new Map(seriesRes.rows.map((r) => [Number(new Date(r.bucket)), r]));
    const series = [];
    const cursor = new Date(start);
    while (cursor <= now && series.length < 400) {
      const key = (() => {
        const c = new Date(cursor);
        if (bucket === 'hour') { c.setMinutes(0, 0, 0); return Number(c); }
        if (bucket === 'day') { c.setHours(0, 0, 0, 0); return Number(c); }
        c.setDate(1); c.setHours(0, 0, 0, 0); return Number(c);
      })();
      const row = byBucket.get(key) || {};
      let label;
      if (range === 'day') label = `${cursor.getHours()}:00`;
      else if (range === 'week') label = cursor.toLocaleDateString('en-GB', { weekday: 'short' });
      else if (range === 'month') label = cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      else label = cursor.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

      series.push({
        label,
        revenue: Math.round((parseFloat(row.revenue) || 0) * 100) / 100,
        transactions: row.transactions || 0,
      });

      if (range === 'day') cursor.setHours(cursor.getHours() + 1);
      else if (range === 'year') cursor.setMonth(cursor.getMonth() + 1), cursor.setDate(1), cursor.setHours(0, 0, 0, 0);
      else cursor.setDate(cursor.getDate() + 1), cursor.setHours(0, 0, 0, 0);
    }

    const revenue = series.reduce((s, p) => s + p.revenue, 0);
    const transactions = series.reduce((s, p) => s + p.transactions, 0);
    const prevRevenue = parseFloat(prevRes.rows[0]?.revenue) || 0;

    res.json({
      range,
      series,
      summary: {
        revenue,
        transactions,
        units_sold: parseInt(unitsRes.rows[0]?.units) || 0,
        prev_revenue: prevRevenue,
        growth_pct: prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build sales series' });
  }
};

// ─── SALES REPORT ─────────────────────────────────────────────────────────────
exports.getSalesReport = async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let dateFilter = '';
    if (from && to) {
      params.push(from, to);
      dateFilter = `AND s.sale_date BETWEEN $1 AND $2`;
    }

    const summary = await db.query(`
      SELECT
        COUNT(DISTINCT s.sale_id) AS transactions,
        COALESCE(SUM(s.total_amount), 0) AS total_revenue,
        COALESCE(SUM(si.quantity), 0) AS units_sold,
        COALESCE(AVG(s.total_amount), 0) AS avg_sale
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.sale_id
      WHERE s.status = 'COMPLETED' ${dateFilter}
    `, params);

    const detail = await db.query(`
      SELECT
        s.sale_date, s.sale_id,
        m.generic_name, m.brand_name,
        si.quantity, si.sell_price, si.discount, si.total_price,
        u.full_name AS pharmacist
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.sale_id
      JOIN batches b ON si.batch_id = b.batch_id
      JOIN medicines m ON b.medicine_id = m.medicine_id
      JOIN users u ON s.user_id = u.user_id
      WHERE s.status = 'COMPLETED' ${dateFilter}
      ORDER BY s.sale_date DESC LIMIT 200
    `, params);

    res.json({ summary: summary.rows[0], items: detail.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── INVENTORY REPORT ─────────────────────────────────────────────────────────
exports.getInventoryReport = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        m.medicine_id, m.generic_name, m.brand_name, m.strength,
        c.name AS category,
        COUNT(b.batch_id) AS batches,
        COALESCE(SUM(b.stock_quantity), 0) AS total_stock,
        COALESCE(SUM(b.stock_quantity * b.buy_price), 0) AS buy_value,
        COALESCE(SUM(b.stock_quantity * b.sell_price), 0) AS sell_value
      FROM medicines m
      LEFT JOIN categories c ON m.category_id = c.category_id
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
      GROUP BY m.medicine_id, m.generic_name, m.brand_name, m.strength, c.name
      ORDER BY total_stock DESC
    `);

    const totals = await db.query(`
      SELECT
        COALESCE(SUM(b.stock_quantity * b.sell_price), 0) AS total_sell_value,
        COALESCE(SUM(b.stock_quantity * b.buy_price), 0) AS total_buy_value,
        COUNT(DISTINCT m.medicine_id) AS total_medicines
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
    `);

    res.json({ summary: totals.rows[0], items: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── PROFIT REPORT ────────────────────────────────────────────────────────────
exports.getProfitReport = async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let dateFilter = '';
    if (from && to) { params.push(from, to); dateFilter = `AND s.sale_date BETWEEN $1 AND $2`; }

    const overview = await db.query(`
      SELECT
        COALESCE(SUM(si.total_price), 0) AS revenue,
        COALESCE(SUM(si.quantity * b.buy_price), 0) AS cogs
      FROM sale_items si
      JOIN batches b ON si.batch_id = b.batch_id
      JOIN sales s ON si.sale_id = s.sale_id
      WHERE s.status = 'COMPLETED' ${dateFilter}
    `, params);

    const byMedicine = await db.query(`
      SELECT
        m.generic_name,
        COALESCE(SUM(si.total_price), 0) AS revenue,
        COALESCE(SUM(si.quantity * b.buy_price), 0) AS cost,
        COALESCE(SUM(si.total_price) - SUM(si.quantity * b.buy_price), 0) AS profit
      FROM sale_items si
      JOIN batches b ON si.batch_id = b.batch_id
      JOIN medicines m ON b.medicine_id = m.medicine_id
      JOIN sales s ON si.sale_id = s.sale_id
      WHERE s.status = 'COMPLETED' ${dateFilter}
      GROUP BY m.medicine_id, m.generic_name
      ORDER BY profit DESC LIMIT 20
    `, params);

    const rev = parseFloat(overview.rows[0].revenue);
    const cost = parseFloat(overview.rows[0].cogs);
    res.json({
      revenue: rev,
      cogs: cost,
      gross_profit: rev - cost,
      gross_margin: rev > 0 ? (((rev - cost) / rev) * 100).toFixed(1) : 0,
      by_medicine: byMedicine.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── EXPIRY REPORT ────────────────────────────────────────────────────────────
exports.getExpiryReport = async (req, res) => {
  try {
    const { window } = req.query; // 'expired', '30', '60', '90', 'all'
    let dateCondition;
    if (window === 'expired') {
      dateCondition = `expiry_date < CURRENT_DATE`;
    } else if (['30','60','90'].includes(window)) {
      dateCondition = `expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${window} days'`;
    } else {
      dateCondition = `expiry_date <= CURRENT_DATE + INTERVAL '90 days'`;
    }

    const result = await db.query(`
      SELECT
        b.batch_id, m.generic_name, b.batch_number,
        s.name AS supplier,
        b.expiry_date,
        (b.expiry_date - CURRENT_DATE) AS days_left,
        b.stock_quantity,
        (b.stock_quantity * b.sell_price) AS value
      FROM batches b
      JOIN medicines m ON b.medicine_id = m.medicine_id
      LEFT JOIN suppliers s ON b.supplier_id = s.supplier_id
      WHERE b.stock_quantity > 0 AND ${dateCondition}
      ORDER BY b.expiry_date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── STOCK MOVEMENT REPORT ────────────────────────────────────────────────────
exports.getMovementReport = async (req, res) => {
  try {
    const { from, to, medicine_id } = req.query;
    const params = [];
    const filters = [];
    if (from && to) { params.push(from, to); filters.push(`sm.movement_date BETWEEN $${params.length - 1} AND $${params.length}`); }
    if (medicine_id) { params.push(medicine_id); filters.push(`m.medicine_id = $${params.length}`); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT
        sm.movement_date, m.generic_name, b.batch_number,
        sm.movement_type,
        CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END AS stock_in,
        CASE WHEN sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END AS stock_out,
        sm.new_stock AS balance,
        u.full_name AS user_name,
        sm.notes
      FROM stock_movements sm
      JOIN batches b ON sm.batch_id = b.batch_id
      JOIN medicines m ON b.medicine_id = m.medicine_id
      JOIN users u ON sm.user_id = u.user_id
      ${where}
      ORDER BY sm.movement_date DESC LIMIT 500
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── FAST/SLOW MOVING ─────────────────────────────────────────────────────────
exports.getMovingReport = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        m.medicine_id, m.generic_name, m.brand_name,
        COALESCE(SUM(si.quantity), 0) AS units_sold,
        COALESCE(SUM(b.stock_quantity), 0) AS current_stock,
        MAX(s.sale_date) AS last_sale_date,
        (CURRENT_DATE - MAX(s.sale_date)::date) AS days_since_sale
      FROM medicines m
      LEFT JOIN batches b ON b.medicine_id = m.medicine_id AND b.status != 'INACTIVE'
      LEFT JOIN sale_items si ON si.batch_id = b.batch_id
      LEFT JOIN sales s ON si.sale_id = s.sale_id AND s.status = 'COMPLETED'
      GROUP BY m.medicine_id, m.generic_name, m.brand_name
      ORDER BY units_sold DESC
    `);

    const fast = result.rows.filter(r => r.units_sold > 0).slice(0, 10);
    const slow = result.rows.filter(r => r.units_sold > 0 && r.days_since_sale > 30).slice(0, 10);
    const dead = result.rows.filter(r => r.current_stock > 0 && (r.units_sold === 0 || r.days_since_sale > 90));

    res.json({ fast, slow, dead });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};

// ─── EMPLOYEE / USER PERFORMANCE ─────────────────────────────────────────────
exports.getUserReport = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        u.user_id, u.full_name, u.username, u.role,
        COUNT(DISTINCT s.sale_id) AS transactions,
        COALESCE(SUM(si.quantity), 0) AS units_sold,
        COALESCE(SUM(s.total_amount), 0) AS revenue
      FROM users u
      LEFT JOIN sales s ON s.user_id = u.user_id AND s.status = 'COMPLETED'
      LEFT JOIN sale_items si ON si.sale_id = s.sale_id
      GROUP BY u.user_id, u.full_name, u.username, u.role
      ORDER BY revenue DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
};
