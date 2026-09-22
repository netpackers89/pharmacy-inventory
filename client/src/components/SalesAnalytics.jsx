import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { reportsAPI } from '../services/api';
import { useTheme } from '../context/ThemeContext';

/*
 * Shared sales analytics chart (Day / Week / Month / Year revenue in ETB).
 * Used on the Dashboard panel and the Reports → Sales tab.
 */

const RANGES = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

const fmtETB = (n) =>
  `ETB ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

export const SalesAnalytics = ({ height = 200, refreshSignal = 0, showHeader = true }) => {
  const { theme } = useTheme();
  const [range, setRange] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reportsAPI.getSalesSeries(range)
      .then((res) => { if (!cancelled) setData(res.data || null); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, refreshSignal]);

  const axisColor = theme === 'dark' ? '#8b95a7' : '#64748b';
  const gridColor = theme === 'dark' ? '#232833' : '#eef0f4';
  const lineColor = theme === 'dark' ? '#f2f4f8' : '#16181d';

  const summary = data?.summary || {};
  const growth = summary.growth_pct;
  const GrowthIcon = growth == null ? Minus : growth > 0 ? ArrowUpRight : growth < 0 ? ArrowDownRight : Minus;

  return (
    <div className="sales-analytics">
      {showHeader && (
        <div className="sales-analytics__head">
          <div>
            <h3 className="dash-panel-title">Sales Analytics</h3>
            <p className="dash-panel-sub">Revenue (ETB) over the selected period</p>
          </div>
          <div className="sales-range-toggle" role="tablist" aria-label="Sales range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={range === r.id}
                className={`sales-range-btn ${range === r.id ? 'active' : ''}`}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sales-analytics__totals">
        <div>
          <span className="sales-analytics__revenue">
            {loading && !data ? '—' : fmtETB(summary.revenue)}
          </span>
          <span className="sales-analytics__meta">
            {summary.transactions ?? 0} transaction{(summary.transactions ?? 0) === 1 ? '' : 's'}
            {' · '}{summary.units_sold ?? 0} units sold
          </span>
        </div>
        {growth != null && (
          <span className={`sales-growth-chip ${growth > 0 ? 'is-up' : growth < 0 ? 'is-down' : ''}`}>
            <GrowthIcon size={13} /> {growth > 0 ? '+' : ''}{growth}% vs prev.
          </span>
        )}
      </div>

      <div style={{ width: '100%', height }}>
        {loading && !data ? (
          <div className="sales-analytics__skeleton" style={{ height }} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data?.series || []} margin={{ top: 8, right: 10, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" stroke={axisColor} fontSize={11} tickLine={false} axisLine={false} minTickGap={18} />
              <YAxis stroke={axisColor} fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} />
              <Tooltip
                cursor={{ stroke: gridColor }}
                contentStyle={{
                  backgroundColor: theme === 'dark' ? '#1d2128' : '#16181d',
                  borderRadius: '10px',
                  border: 'none',
                  color: '#f2f4f8',
                  fontSize: '0.78rem',
                }}
                formatter={(val, key) =>
                  key === 'revenue' ? [fmtETB(val), 'Revenue'] : [val, 'Transactions']
                }
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={lineColor}
                strokeWidth={2.2}
                fill="url(#salesFill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
