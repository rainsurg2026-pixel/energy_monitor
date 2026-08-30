import type { ReportSection, ReportSectionId, ReportType } from "./reportingTypes";

const sections: ReportSection[] = [
  { id: "executive", title: "Executive", reportTypes: ["executive", "all"] },
  { id: "dashboard", title: "Dashboard", reportTypes: ["dashboard", "all"] },
  { id: "rack-capacity", title: "Rack Capacity", reportTypes: ["rack-capacity", "all"] },
  { id: "rack-unit-capacity", title: "Rack Unit Capacity", reportTypes: ["rack-unit-capacity", "all"] },
  { id: "ups", title: "UPS", reportTypes: ["dashboard", "monthly-energy", "all"] },
  { id: "air-conditioning", title: "Air Conditioning", reportTypes: ["dashboard", "monthly-energy", "all"] },
  { id: "dc", title: "DC", reportTypes: ["dashboard", "monthly-energy", "all"] },
  { id: "historical", title: "Historical", reportTypes: ["historical", "all"] },
  { id: "site-energy-comparison", title: "Site Energy & Cost Comparison", reportTypes: ["site-comparison", "all"] },
  { id: "site-rack-comparison", title: "Site Rack Capacity & Availability Comparison", reportTypes: ["site-comparison", "all"] },
  { id: "appendix", title: "Appendix", reportTypes: ["all"] }
];

/** Canonical reporting registration point. New report content belongs here. */
export const ReportRegistry = {
  all: (): readonly ReportSection[] => sections,
  get: (id: ReportSectionId) => sections.find(section => section.id === id),
  forType: (type: ReportType) => sections.filter(section => section.reportTypes.includes(type))
};
