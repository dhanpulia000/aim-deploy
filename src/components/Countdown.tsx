import React, { useState, useEffect } from "react";

interface CountdownProps {
  to?: number;
}

export const Countdown: React.FC<CountdownProps> = ({ to }) => {
  const [, force] = useState(0);
  useEffect(() => {
    if (!to) return;
    const id = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [to]);
  
  if (!to) return <span className="text-slate-400">—</span>;
  
  const d = to - Date.now();
  const neg = d < 0;
  const abs = Math.abs(d);
  const mm = Math.floor(abs / 60000);
  const ss = Math.floor((abs % 60000) / 1000);
  
  return (
    <span className={`font-mono ${neg ? "text-red-600" : "text-slate-700"}`}>
      {neg ? "-" : ""}{mm}:{ss.toString().padStart(2, '0')}
    </span>
  );
};












