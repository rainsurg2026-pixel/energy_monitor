import React, { useMemo } from "react";
import { useReport } from "../ReportContext";
import { MonthlyLog } from "../types";
import { computeAllMetrics } from "../utils/analytics";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { 
  Compass, 
  Lightbulb, 
  Zap, 
  Coins, 
  Percent, 
  Activity, 
  AlertTriangle, 
  TrendingUp, 
  CheckCircle 
} from "lucide-react";

interface SmartInsightPanelProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
}

export default function SmartInsightPanel({ logs, lang }: SmartInsightPanelProps) {
  const { selectedYear } = useReport();
  const allMetrics = useMemo(() => {
    return computeAllMetrics(logs)
      .filter(metric => metric.month.startsWith(`${selectedYear}-`))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [logs, selectedYear]);

  // Find anomalies or cost spikes
  const insights = useMemo(() => {
    if (allMetrics.length < 2) return [];

    const list: {
      type: "alert" | "info" | "success" | "warning";
      titleTh: string;
      titleEn: string;
      descTh: string;
      descEn: string;
      icon: any;
      color: string;
    }[] = [];

    const latest = allMetrics[allMetrics.length - 1];
    const previous = allMetrics[allMetrics.length - 2];

    // 1. PUE Efficiency Insight. A null PUE is an expected result when the
    // month is incomplete (for example, a missing UPS 11A input), so it must
    // not be formatted as a number.
    if (latest.pue !== null && latest.pue > 1.6) {
      list.push({
        type: "alert",
        titleTh: "ประสิทธิภาพพลังงาน PUE อยู่ในเกณฑ์ต้องปรับปรุง",
        titleEn: "PUE efficiency needs optimization",
        descTh: `ค่าเฉลี่ย PUE เดือนล่าสุด อยู่ที่ ${formatNumber2(latest.pue)} ซึ่งสูงกว่าค่าเป้าหมายมาตรฐานอุตสาหกรรม (1.5) แนะนำให้ปรับแต่งปริมาณลมเย็นและอุณหภูมิห้องเครื่องให้อยู่ที่ 22-24°C`,
        descEn: `Current PUE is ${formatNumber2(latest.pue)}, exceeding the green standard threshold of 1.5. Inspect cooling flow rates and raise server room ambient setpoints to 22-24°C to save HVAC loads.`,
        icon: Percent,
        color: "text-rose-400 border-rose-500/15 bg-rose-500/5"
      });
    } else if (latest.pue !== null) {
      list.push({
        type: "success",
        titleTh: "ประสิทธิภาพพลังงาน PUE อยู่ในเกณฑ์ดีเยี่ยม",
        titleEn: "Optimal PUE Rating achieved",
        descTh: `ค่าเฉลี่ย PUE ล่าสุด อยู่ที่ ${formatNumber2(latest.pue)} สอดคล้องกับมาตรฐานศูนย์ข้อมูลคาร์บอนต่ำสีเขียวในระดับสากล`,
        descEn: `Current PUE is ${formatNumber2(latest.pue)}, meeting green low-carbon data center standards. Outstanding cooling balance and operations setup.`,
        icon: CheckCircle,
        color: "text-emerald-400 border-emerald-500/15 bg-emerald-500/5"
      });
    }

    // 2. Cost Spike detection
    const costGrowth = latest.actualCostThb !== null && previous.actualCostThb !== null && previous.actualCostThb !== 0
      ? ((latest.actualCostThb - previous.actualCostThb) / previous.actualCostThb) * 100
      : null;
    if (costGrowth !== null && costGrowth > 10) {
      list.push({
        type: "warning",
        titleTh: "ตรวจพบค่าไฟอาคารเพิ่มสูงขึ้นแบบกะทันหัน",
        titleEn: "Significant energy cost spike detected",
        descTh: `ค่าใช้จ่ายพลังงานเดือนนี้เพิ่มขึ้นถึง ${formatNumber2(costGrowth)}% เทียบกับเดือนก่อนหน้า ควรระวังชั่วโมงพลังงานสูญเสีย (Peak demand hour) ของศูนย์ข้อมูลชั้น 4`,
        descEn: `Energy cost increased by ${formatNumber2(costGrowth)}% compared to last month. Analyze peak demand hours and schedule optional testing or heavy batch operations off-peak.`,
        icon: Coins,
        color: "text-amber-400 border-amber-500/15 bg-amber-500/5"
      });
    }

    // 3. Electrical abnormal checks (UPS load balance / voltage anomalies)
    const activeAlertsCount = latest.alerts.length;
    if (activeAlertsCount > 0) {
      list.push({
        type: "alert",
        titleTh: "ตรวจพบแรงดันหรือค่าทางวิศวกรรมไฟฟ้าผิดปกติ",
        titleEn: "Electrical threshold alerts detected",
        descTh: `พบระดับความผิดปกติทางไฟฟ้าหรือค่าไม่สมมาตรจำนวน ${activeAlertsCount} รายการ ตรวจสอบรายงานสถานะของเครื่อง UPS และแผงจ่ายไฟ DC ด่วนเพื่อความมั่นคงของเซิร์ฟเวอร์`,
        descEn: `Found ${activeAlertsCount} electric parameters exceeding safe thresholds. Inspect UPS loads or DC telecom breaker inputs immediately to protect reliability.`,
        icon: AlertTriangle,
        color: "text-rose-400 border-rose-500/15 bg-rose-500/5"
      });
    } else {
      list.push({
        type: "success",
        titleTh: "พารามิเตอร์ไฟฟ้าทั้งหมดทำงานเสถียร 100%",
        titleEn: "Electrical parameters 100% stable",
        descTh: "แรงดันและค่ากระแสของทุกแผงจ่ายไฟฟ้าทำงานสอดคล้องภายใต้ระดับสภาวะมาตรฐานวิศวกรรมอาคาร",
        descEn: "All logged UPS and DC voltage/current parameters are operating securely within standard nominal thresholds.",
        icon: Activity,
        color: "text-emerald-400 border-emerald-500/15 bg-emerald-500/5"
      });
    }

    // 4. Data Quality Insight
    if (latest.dataQualityScore < 90) {
      list.push({
        type: "info",
        titleTh: "คะแนนคุณภาพข้อมูลต่ำกว่าเกณฑ์ความน่าเชื่อถือ",
        titleEn: "Incomplete log inputs detected",
        descTh: `ความสมบูรณ์ข้อมูลอยู่ที่ ${latest.dataQualityScore}% แนะนำให้กรอกพารามิเตอร์ที่ว่างทั้งหมดเพื่อให้แบบจำลองพยากรณ์และการคำนวณสรุปถูกต้อง 100%`,
        descEn: `Log integrity index dropped to ${latest.dataQualityScore}%. Please complete all empty variables on data entry tabs to ensure accurate ESG and PUE reporting.`,
        icon: Compass,
        color: "text-sky-400 border-sky-500/15 bg-sky-500/5"
      });
    }

    return list;
  }, [allMetrics]);

  const dict = {
    th: {
      title: "ศูนย์ข้อมูลวิเคราะห์อัจฉริยะ (Smart Operations Insights)",
      desc: "ระบบตรวจจับสิ่งผิดปกติ (Anomaly Detection) อัตโนมัติ พร้อมคำแนะนำในการบริหารจัดการแบบประหยัดพลังงาน",
      empty: "ต้องการข้อมูลเพิ่มเติมเพื่อวิเคราะห์และแสดงคำแนะนำอัจฉริยะ"
    },
    en: {
      title: "Smart Facility Analytics Panel",
      desc: "Automated anomaly detections, optimization recommendations, and green IT actions derived directly from operations logs.",
      empty: "Additional month logs required to run smart anomaly operations."
    }
  };

  const t = dict[lang];

  if (insights.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl text-center text-xs text-slate-500">
        {t.empty}
      </div>
    );
  }

  return (
    <section className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-4">
      <div>
        <h3 className="font-display font-bold text-sm text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400 animate-pulse" />
          <span>{t.title}</span>
        </h3>
        <p className="text-[11px] text-slate-400 mt-1">{t.desc}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map((ins, idx) => {
          const Icon = ins.icon;
          return (
            <div 
              key={idx} 
              className={`p-4 rounded-xl border flex gap-3 items-start ${ins.color} transition-all duration-350 hover:-translate-y-0.5`}
            >
              <div className="p-2 bg-slate-950/40 rounded-lg text-current shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-slate-100">{lang === "th" ? ins.titleTh : ins.titleEn}</h4>
                <p className="text-[11px] text-slate-300 leading-relaxed font-sans">{lang === "th" ? ins.descTh : ins.descEn}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
