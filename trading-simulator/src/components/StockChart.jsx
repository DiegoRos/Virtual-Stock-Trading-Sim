import React, { useMemo, useState, useCallback } from 'react';

const EMPTY_CHART_DATA = [
  { price: 0, timestamp: 0 },
  { price: 0, timestamp: 1 }
];

const StockChart = ({ data, timeframe, onHover, onLeave }) => {
  const chartWidth = 900;
  const chartHeight = 250;
  const paddingLeft = 70;
  const paddingRight = 20;
  const paddingBottom = 40;
  const paddingTop = 20;

  const [hoveredIndex, setHoveredIndex] = useState(null);

  const hasData = Array.isArray(data) && data.length > 0;
  const chartData = hasData ? data : EMPTY_CHART_DATA;
  const pointDivisor = Math.max(chartData.length - 1, 1);

  const prices = chartData.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;
  const padding = range * 0.15;
  const trueMin = minPrice - padding;
  const trueMax = maxPrice + padding;
  const trueRange = trueMax - trueMin;

  const getX = (i) => paddingLeft + (i / pointDivisor) * chartWidth;
  const getY = (price) => chartHeight - ((price - trueMin) / trueRange) * chartHeight + paddingTop;

  const points = chartData.map((d, i) => `${getX(i)},${getY(d.price)}`).join(' ');

  const isPositive = chartData[chartData.length - 1].price >= chartData[0].price;
  const color = isPositive ? '#22c55e' : '#ef4444';

  const yLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < 5; i++) {
      const price = trueMin + (i * (trueRange / 4));
      labels.push({ price, y: getY(price) });
    }
    return labels;
  }, [trueMin, trueRange]);

  const xLabels = useMemo(() => {
    const labels = [];
    const count = 5;
    const step = Math.max(Math.floor((chartData.length - 1) / (count - 1)), 1);
    for (let i = 0; i < count; i++) {
      const index = Math.min(i * step, chartData.length - 1);
      const d = chartData[index];
      const x = getX(index);
      const date = new Date(d.timestamp);
      let label = '';
      if (timeframe === '1D') {
        label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (timeframe === '5D' || timeframe === '1W' || timeframe === '1M') {
        label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } else if (timeframe === '1Y') {
        label = date.toLocaleDateString([], { month: 'short', year: '2-digit' });
      } else {
        label = date.toLocaleDateString([], { year: 'numeric' });
      }
      labels.push({ label, x });
    }
    return labels;
  }, [chartData, pointDivisor, timeframe]);

  const handleMouseMove = useCallback((e) => {
    if (!hasData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const viewBoxWidth = chartWidth + paddingLeft + paddingRight;
    const svgX = ((e.clientX - rect.left) / rect.width) * viewBoxWidth;
    const rawIndex = ((svgX - paddingLeft) / chartWidth) * (chartData.length - 1);
    const idx = Math.max(0, Math.min(chartData.length - 1, Math.round(rawIndex)));
    setHoveredIndex(idx);
    if (onHover) onHover(chartData[idx]);
  }, [hasData, chartData, onHover]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    if (onLeave) onLeave();
  }, [onLeave]);

  if (!hasData) return null;

  const hoveredPoint = hoveredIndex !== null ? chartData[hoveredIndex] : null;
  const hoverX = hoveredIndex !== null ? getX(hoveredIndex) : null;
  const hoverY = hoveredPoint ? getY(hoveredPoint.price) : null;

  return (
    <div className="w-full h-full relative">
      <svg
        viewBox={`0 0 ${chartWidth + paddingLeft + paddingRight} ${chartHeight + paddingTop + paddingBottom}`}
        className="w-full h-full overflow-visible cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {yLabels.map((l, i) => (
          <React.Fragment key={i}>
            <line x1={paddingLeft} y1={l.y} x2={chartWidth + paddingLeft} y2={l.y}
              stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
            <text x={paddingLeft - 8} y={l.y + 4} textAnchor="end"
              className="fill-slate-500 text-[12px] font-medium">
              ${l.price.toFixed(2)}
            </text>
          </React.Fragment>
        ))}

        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={chartHeight + paddingTop + 25}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            className="fill-slate-500 text-[12px] font-medium uppercase tracking-wider">
            {l.label}
          </text>
        ))}

        <polyline fill="none" stroke={color} strokeWidth="2.5" points={points}
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <polygon fill="url(#chartGradient)"
          points={`${paddingLeft},${chartHeight + paddingTop} ${points} ${chartWidth + paddingLeft},${chartHeight + paddingTop}`} />

        {/* Current price dashed line */}
        <line
          x1={paddingLeft} y1={getY(chartData[chartData.length - 1].price)}
          x2={chartWidth + paddingLeft} y2={getY(chartData[chartData.length - 1].price)}
          stroke={color} strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />

        {/* Hover crosshair */}
        {hoveredPoint && (
          <>
            <line x1={hoverX} y1={paddingTop} x2={hoverX} y2={chartHeight + paddingTop}
              stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx={hoverX} cy={hoverY} r="5"
              fill={color} stroke="white" strokeWidth="2" />
            <rect x={paddingLeft - 62} y={hoverY - 11} width={54} height={20}
              fill="#1e293b" rx="3" />
            <text x={paddingLeft - 35} y={hoverY + 5} textAnchor="middle"
              fill="white" fontSize="11" fontWeight="600">
              ${hoveredPoint.price.toFixed(2)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
};

export default StockChart;
