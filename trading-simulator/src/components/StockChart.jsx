import React, { useMemo } from 'react';

const EMPTY_CHART_DATA = [
  { price: 0, timestamp: 0 },
  { price: 0, timestamp: 1 }
];

const StockChart = ({ data, timeframe }) => {
  const chartWidth = 900;
  const chartHeight = 250;
  const paddingLeft = 70;
  const paddingRight = 20;
  const paddingBottom = 40;
  const paddingTop = 20;
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

  const points = chartData.map((d, i) => {
    const x = paddingLeft + (i / pointDivisor) * chartWidth;
    const y = chartHeight - ((d.price - trueMin) / trueRange) * chartHeight + paddingTop;
    return `${x},${y}`;
  }).join(' ');

  const isPositive = chartData[chartData.length - 1].price >= chartData[0].price;
  const color = isPositive ? '#22c55e' : '#ef4444';

  // Generate Y-axis labels (Prices)
  const yLabels = useMemo(() => {
    const labels = [];
    const count = 5;
    for (let i = 0; i < count; i++) {
      const price = trueMin + (i * (trueRange / (count - 1)));
      const y = chartHeight - ((price - trueMin) / trueRange) * chartHeight + paddingTop;
      labels.push({ price, y });
    }
    return labels;
  }, [trueMin, trueRange]);

  // Generate X-axis labels (Dates)
  const xLabels = useMemo(() => {
    const labels = [];
    const count = 5;
    const step = Math.max(Math.floor((chartData.length - 1) / (count - 1)), 1);

    for (let i = 0; i < count; i++) {
      const index = Math.min(i * step, chartData.length - 1);
      const d = chartData[index];
      const x = paddingLeft + (index / pointDivisor) * chartWidth;

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

  if (!hasData) return null;

  return (
    <div className="w-full h-full relative">
      <svg
        viewBox={`0 0 ${chartWidth + paddingLeft + paddingRight} ${chartHeight + paddingTop + paddingBottom}`}
        className="w-full h-full overflow-visible"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Y-Axis Grid Lines and Labels */}
        {yLabels.map((l, i) => (
          <React.Fragment key={i}>
            <line
              x1={paddingLeft} y1={l.y} x2={chartWidth + paddingLeft} y2={l.y}
              stroke="#334155" strokeWidth="1" strokeDasharray="4 4"
            />
            <text
              x={paddingLeft - 8} y={l.y + 4}
              textAnchor="end"
              className="fill-slate-500 text-[12px] font-medium"
            >
              ${l.price.toFixed(2)}
            </text>
          </React.Fragment>
        ))}

        {/* X-Axis Labels */}
        {xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x} y={chartHeight + paddingTop + 25}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            className="fill-slate-500 text-[12px] font-medium uppercase tracking-wider"
          >
            {l.label}
          </text>
        ))}

        {/* Chart Lines */}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          points={points}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polygon
          fill="url(#chartGradient)"
          points={`${paddingLeft},${chartHeight + paddingTop} ${points} ${chartWidth + paddingLeft},${chartHeight + paddingTop}`}
        />

        {/* Current Price Line */}
        <line
          x1={paddingLeft} y1={chartHeight - ((chartData[chartData.length-1].price - trueMin) / trueRange) * chartHeight + paddingTop}
          x2={chartWidth + paddingLeft} y2={chartHeight - ((chartData[chartData.length-1].price - trueMin) / trueRange) * chartHeight + paddingTop}
          stroke={color} strokeWidth="1" strokeDasharray="2 2" opacity="0.5"
        />
      </svg>
    </div>
  );
};

export default StockChart;
