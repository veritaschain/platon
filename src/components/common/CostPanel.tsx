"use client";

import { useEffect } from "react";
import { useUsageStore } from "@/stores/usage-store";
import { formatCost } from "@/lib/utils";

export function CostPanel() {
  const { daily, monthly, dailyPercent, monthlyPercent, fetchUsage } = useUsageStore();

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 30000);
    return () => clearInterval(interval);
  }, []);

  const ProgressBar = ({ percent, color }: { percent: number; color: string }) => (
    <div className="h-2 bg-secondary rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );

  return (
    <div className="p-4 space-y-6">
      {dailyPercent >= 80 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-700 font-medium">⚠️ コスト上限に近づいています</p>
          <p className="text-xs text-amber-600 mt-1">高額モデルは自動的に軽量モデルに切り替わっています</p>
        </div>
      )}

      {/* Daily */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium text-foreground">今日</span>
          <span className="text-muted-foreground">
            {formatCost(daily)} / $5.00
          </span>
        </div>
        <ProgressBar
          percent={dailyPercent}
          color={
            dailyPercent >= 90 ? "bg-red-500" :
            dailyPercent >= 80 ? "bg-amber-500" :
            "bg-primary"
          }
        />
        <p className="text-xs text-muted-foreground">{dailyPercent.toFixed(1)}% 使用</p>
      </div>

      {/* Monthly */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium text-foreground">今月</span>
          <span className="text-muted-foreground">
            {formatCost(monthly)} / $20.00
          </span>
        </div>
        <ProgressBar
          percent={monthlyPercent}
          color={
            monthlyPercent >= 90 ? "bg-red-500" :
            monthlyPercent >= 80 ? "bg-amber-500" :
            "bg-primary"
          }
        />
        <p className="text-xs text-muted-foreground">{monthlyPercent.toFixed(1)}% 使用</p>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>• 80%到達: 高額モデルを自動で軽量モデルに変更</p>
        <p>• 100%到達: 送信がブロックされます</p>
      </div>
    </div>
  );
}
