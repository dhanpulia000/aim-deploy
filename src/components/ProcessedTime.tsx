import React from "react";

interface ProcessedTimeProps {
  processedAt?: number | null;
  createdAt: number;
}

export const ProcessedTime: React.FC<ProcessedTimeProps> = ({ processedAt, createdAt }) => {
  if (!processedAt) return <span className="text-slate-400 text-xs">—</span>;
  
  const duration = processedAt - createdAt;
  const hours = Math.floor(duration / 3600000);
  const minutes = Math.floor((duration % 3600000) / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  
  if (hours > 0) {
    return (
      <span className="text-xs text-slate-600 font-mono">
        {hours}:{minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
      </span>
    );
  } else {
    return (
      <span className="text-xs text-slate-600 font-mono">
        {minutes}:{seconds.toString().padStart(2, '0')}
      </span>
    );
  }
};












