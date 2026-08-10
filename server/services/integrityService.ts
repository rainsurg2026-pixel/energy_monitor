import { HttpError } from "../errors";
import { allowedMonths, assertStrictMonth, isAllowedMonth, type DisplayPeriod } from "../policies/displayPeriod";
import type { BackendRepository, SiteRecord } from "../repositories/contracts";

export interface IntegrityFinding { month: string; sections: string[]; }
export interface WebIntegrityReport {
  siteId: number;
  facility: string;
  displayPeriod: DisplayPeriod;
  validatedAt: string;
  structureOk: boolean;
  monthCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  availableMonths: string[];
  missingMonths: string[];
  missingSections: IntegrityFinding[];
  duplicateMonths: string[];
  invalidMonths: string[];
  errors: string[];
  warnings: string[];
  scope: "postgres-monthly-log-projection";
}

function monthOfDate(date: Date): string { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }

export class IntegrityService {
  constructor(private readonly repository: BackendRepository, private readonly now: () => Date = () => new Date()) {}

  private async requireSite(siteId: number): Promise<SiteRecord> {
    const site = await this.repository.getSite(siteId);
    if (!site || !site.active) throw new HttpError(404, "SITE_NOT_FOUND", "Site was not found.");
    return site;
  }

  private async requirePeriod(): Promise<DisplayPeriod> {
    const period = await this.repository.getGlobalSettings();
    if (!period) throw new HttpError(503, "DISPLAY_PERIOD_NOT_CONFIGURED", "Global Display Period has not been configured.");
    return period;
  }

  async buildReport(siteId: number): Promise<WebIntegrityReport> {
    const [site, displayPeriod] = await Promise.all([this.requireSite(siteId), this.requirePeriod()]);
    const asOf = monthOfDate(this.now());
    const allowedPastMonths = allowedMonths(displayPeriod).filter(month => month <= asOf);
    const periods = await this.repository.listPeriods(siteId);
    const rawMonths = periods.map(period => period.month);
    const duplicateMonths = rawMonths.filter((month, index, all) => all.indexOf(month) !== index);
    const invalidMonths: string[] = [];
    for (const month of rawMonths) {
      try { assertStrictMonth(month, "period.month"); } catch { invalidMonths.push(month); }
    }
    const availableMonths = [...new Set(rawMonths.filter(month => isAllowedMonth(month, displayPeriod) && month <= asOf))].sort();
    const missingMonths = allowedPastMonths.filter(month => !availableMonths.includes(month));
    const logs = await this.repository.getMonthlyLogs(siteId, availableMonths);
    const missingSections: IntegrityFinding[] = logs.map(log => {
      const sections: string[] = [];
      const airValues = [log.air.eb41a, log.air.eb41b, log.air.eb42a, log.air.eb42b, ...Object.values(log.air.meters ?? {})];
      if (log.ups.length === 0) sections.push("UPS");
      if (airValues.every(value => value === null || value === undefined)) sections.push("AIR");
      if (log.dc.length === 0) sections.push("DC");
      if (log.energyCost.buildingEnergyKwh === null && log.energyCost.buildingElectricityCostThb === null) sections.push("ENERGY");
      return { month: log.month, sections };
    }).filter(finding => finding.sections.length > 0);
    const errors = [
      ...(invalidMonths.length ? [`Invalid month keys: ${invalidMonths.join(", ")}.`] : []),
      ...(duplicateMonths.length ? [`Duplicate month keys: ${[...new Set(duplicateMonths)].join(", ")}.`] : [])
    ];
    const warnings = [
      ...(missingMonths.length ? [`${missingMonths.length} month(s) in the effective Display Period have no imported dataset.`] : []),
      ...(missingSections.length ? [`${missingSections.length} month(s) have one or more empty source sections.`] : [])
    ];
    return {
      siteId,
      facility: site.name,
      displayPeriod,
      validatedAt: new Date().toISOString(),
      structureOk: true,
      monthCount: availableMonths.length,
      firstMonth: availableMonths[0] ?? null,
      lastMonth: availableMonths.at(-1) ?? null,
      availableMonths,
      missingMonths,
      missingSections,
      duplicateMonths: [...new Set(duplicateMonths)],
      invalidMonths,
      errors,
      warnings,
      scope: "postgres-monthly-log-projection"
    };
  }
}
