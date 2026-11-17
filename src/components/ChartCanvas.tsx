import { useEffect, useRef } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip
);

interface ChartCanvasProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: ChartConfiguration<any, any, any>;
  className?: string;
  ariaLabel?: string;
}

export function ChartCanvas({ config, className = 'h-[260px] w-full', ariaLabel }: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<Chart<any, any, any> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new Chart(canvas, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config]);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={canvasRef} aria-label={ariaLabel} />
    </div>
  );
}
