const STORAGE_KEYS = {
  theme: "moe-dashboard-theme",
  sidebar: "moe-dashboard-sidebar",
  settings: "moe-dashboard-settings",
  session: "moe-dashboard-session",
};

let scrollRevealObserver = null;
let appControlsBound = false;
let dashboardMotionFrame = null;
const INTRO_SPLASH_DURATION = 2200;
const API_ENDPOINTS = {
  bootstrap: "/api/bootstrap",
  login: "/api/login",
  analyzeIndicators: "/api/indicators/analyze",
};
const ANALYSIS_API_EXPERIMENT_URL = "http://127.0.0.1:8001/analyze";

const apiState = {
  authUser: null,
  trainees: [],
};

const INDICATOR_TONES = {
  cyan: { accent: "var(--indicators-chart-1)", glow: "var(--indicators-accent-glow)" },
  mint: { accent: "var(--indicators-chart-3)", glow: "var(--indicators-accent-glow)" },
  violet: { accent: "var(--indicators-chart-5)", glow: "var(--indicators-accent-glow)" },
  teal: { accent: "var(--indicators-chart-2)", glow: "var(--indicators-accent-glow)" },
  amber: { accent: "var(--indicators-chart-4)", glow: "var(--indicators-warning-soft)" },
  blue: { accent: "var(--indicators-chart-1)", glow: "var(--indicators-accent-glow)" },
};

const DASHBOARD_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const uiState = {
  isAuthenticated: false,
  sessionUser: null,
  currentView: "dashboard",
  dashboardSearch: "",
  dashboardPriorityTab: "all",
  dashboardInsightDepartment: "all",
  alertsFocusGroup: null,
  alertsFocusTraineeId: null,
  alertSearch: "",
  notificationsOpen: false,
  reportSearch: "",
  indicatorsAnalysis: null,
  indicatorsUploadState: "idle",
  indicatorsUploadName: "",
  indicatorsUploadError: "",
  indicatorsSelectedFile: null,
  indicatorsApiExperimentState: "idle",
  indicatorsApiExperimentResult: null,
  indicatorsApiExperimentError: "",
  activeSummaryCard: null,
  activeActionCard: null,
  selectedTraineeId: 1002,
  traineesFilters: {
    search: "",
    department: "all",
    status: "all",
    remaining: "all",
  },
  reportFilters: {
    period: "all",
    department: "all",
    status: "all",
  },
  settings: {
    useHijriDates: false,
    dailyAlerts: true,
    compactIndicators: false,
  },
  followedPriorityIds: [],
  traineeDrafts: {},
};

const viewMeta = {
  dashboard: {
    title: "الرئيسية",
    subtitle: "",
    topbarSearchPlaceholder: "ابحث في أقرب المتدربين انتهاء",
  },
  indicators: {
    title: "المؤشرات",
    subtitle: "رفع ملفات Excel وتحليلها بدقة عالية عبر Python داخل لوحة مؤشرات تفاعلية",
    topbarSearchPlaceholder: "ابحث في نتائج التحليل والحقول المكتشفة",
  },
  trainees: {
    title: "المتدربين",
    subtitle: "متابعة بيانات المتدربين والبحث والتصفية حسب الحالة والإدارة",
    topbarSearchPlaceholder: "ابحث عن متدرب أو إدارة",
  },
  "trainee-details": {
    title: "تفاصيل المتدرب",
    subtitle: "عرض الملف الإداري المختصر للمتدرب ومتابعة حالته الحالية",
    topbarSearchPlaceholder: "ابحث في ملف المتدرب",
  },
  alerts: {
    title: "التنبيهات",
    subtitle: "مراجعة الحالات التي تحتاج متابعة أو إجراء مباشر",
    topbarSearchPlaceholder: "ابحث في التنبيهات",
  },
  reports: {
    title: "التقارير",
    subtitle: "مراجعة الملخصات الرسمية وتصفية البيانات لأغراض المتابعة",
    topbarSearchPlaceholder: "ابحث في بيانات التقارير",
  },
  settings: {
    title: "الإعدادات",
    subtitle: "ضبط المظهر والإعدادات العامة بما يلائم بيئة العمل اليومية",
    topbarSearchPlaceholder: "ابحث في الإعدادات",
  },
};

function safeReadStorage(key, fallbackValue) {
  try {
    return localStorage.getItem(key) || fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function safeWriteStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function safeReadJsonStorage(key, fallbackValue) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function clearStorageKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    return;
  }
}

async function apiRequest(url, options = {}) {
  const headers = {
    Accept: "application/json",
    ...options.headers,
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || "تعذر إتمام الطلب من الخادم.");
  }

  return payload;
}

async function loadBootstrapData() {
  const payload = await apiRequest(API_ENDPOINTS.bootstrap);
  apiState.authUser = payload?.authUser || null;
  apiState.trainees = Array.isArray(payload?.trainees) ? payload.trainees : [];
}

function getApiAuthUser() {
  return apiState.authUser;
}

function getApiTrainees() {
  return apiState.trainees;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",").pop() : result;
      resolve(base64 || "");
    };

    reader.onerror = () => {
      reject(new Error("تعذر قراءة الملف المرفوع."));
    };

    reader.readAsDataURL(file);
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getClosestElement(target, selector) {
  return target instanceof Element ? target.closest(selector) : null;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ar-SA").format(value);
}

function formatArabicCountPhrase(count, { singular, dual, plural }) {
  if (count === 1) {
    return singular;
  }

  if (count === 2) {
    return dual;
  }

  return `${formatNumber(count)} ${plural}`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function parseDate(dateValue) {
  return new Date(`${dateValue}T00:00:00`);
}

function getReferenceDate() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function getDateLocale() {
  return uiState.settings.useHijriDates ? "ar-SA" : "ar-SA-u-ca-gregory";
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat(getDateLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parseDate(dateValue));
}

function formatCurrentDate() {
  return new Intl.DateTimeFormat(getDateLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(getReferenceDate());
}

function getDaysLeft(dateValue) {
  const differenceInMs = parseDate(dateValue) - getReferenceDate();
  return Math.round(differenceInMs / (1000 * 60 * 60 * 24));
}

function getStatusTone(status) {
  switch (status) {
    case "عاجل":
      return {
        background: "var(--tone-warning-soft)",
        color: "var(--tone-warning)",
        className: "pill--warning",
      };
    case "قريب انتهاء":
      return {
        background: "var(--tone-info-soft)",
        color: "var(--tone-info)",
        className: "pill--info",
      };
    case "بيانات ناقصة":
      return {
        background: "var(--tone-accent-soft)",
        color: "var(--tone-accent)",
        className: "pill--accent",
      };
    case "منتهي":
      return {
        background: "var(--tone-neutral-soft)",
        color: "var(--tone-neutral)",
        className: "pill--danger",
      };
    default:
      return {
        background: "var(--tone-success-soft)",
        color: "var(--tone-success)",
        className: "pill--success",
      };
  }
}

function deriveStatus(trainee, daysLeft) {
  if (daysLeft < 0) {
    return "منتهي";
  }

  if (trainee.missingData) {
    return "بيانات ناقصة";
  }

  if (daysLeft <= 7) {
    return "عاجل";
  }

  if (daysLeft <= 30) {
    return "قريب انتهاء";
  }

  return "نشط";
}

function getAllTrainees() {
  return getApiTrainees().map((trainee) => {
    const traineeDraft = uiState.traineeDrafts[trainee.id] || {};
    const daysLeft = getDaysLeft(trainee.endDate);
    const derivedStatus = deriveStatus(trainee, daysLeft);
    const status = traineeDraft.status || derivedStatus;

    return {
      ...trainee,
      agency: trainee.agency || "وزارة التعليم - الإدارة العامة للتدريب والابتعاث",
      daysLeft,
      notes: traineeDraft.notes || trainee.notes,
      status,
      statusTone: getStatusTone(status),
    };
  });
}

function getUniqueDepartments() {
  return [...new Set(getAllTrainees().map((trainee) => trainee.department))];
}

function matchesDashboardSearch(trainee) {
  const normalizedQuery = uiState.dashboardSearch.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [trainee.name, trainee.department, trainee.status, trainee.supervisor]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function getDashboardScopedTrainees() {
  return getAllTrainees().filter((trainee) => matchesDashboardSearch(trainee));
}

function getDashboardSummaryCards() {
  return getSummaryCardsForTrainees(getDashboardScopedTrainees());
}

function getIndicatorsSummaryCards() {
  return getSummaryCardsForTrainees(getDashboardInsightTrainees());
}

function getSummaryCardsForTrainees(trainees) {
  const expiringSoon = trainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30);
  const urgentTrainees = trainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 7);
  const expiredTrainees = trainees.filter((trainee) => trainee.daysLeft < 0);

  return [
    {
      label: "إجمالي المتدربين",
      value: trainees.length,
      meta: "يشمل جميع المتدربين المسجلين في الجهة",
      tone: "accent",
    },
    {
      label: "أقل من 7 أيام",
      value: urgentTrainees.length,
      meta: "أولوية عالية لاتخاذ الإجراء",
      tone: "success",
    },
    {
      label: "أقل من 30 يوم",
      value: expiringSoon.length,
      meta: "حالات تحتاج متابعة خلال الفترة القريبة",
      tone: "info",
    },
    {
      label: "المنتهية فترتهم",
      value: expiredTrainees.length,
      meta: "تتطلب إغلاقًا أو تمديدًا أو تحديثًا",
      tone: "warning",
    },
  ];
}

function getDashboardActionCards() {
  const trainees = getDashboardScopedTrainees();

  return [
    {
      label: "من سينتهي خلال 7 أيام",
      count: trainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 7).length,
      text: "متدربون يتطلبون مراجعة عاجلة قبل انتهاء المدة النظامية مباشرة.",
      tone: getStatusTone("عاجل"),
    },
    {
      label: "من سينتهي خلال 30 يوم",
      count: trainees.filter((trainee) => trainee.daysLeft >= 8 && trainee.daysLeft <= 30).length,
      text: "حالات قريبة تستلزم متابعة مبكرة مع الإدارات والمشرفين.",
      tone: getStatusTone("قريب انتهاء"),
    },
    {
      label: "بيانات ناقصة",
      count: trainees.filter((trainee) => trainee.missingData).length,
      text: "ملفات تحتاج استكمال مستندات أو تحديث بيانات أساسية قبل الإغلاق.",
      tone: getStatusTone("بيانات ناقصة"),
    },
    {
      label: "من انتهت فترتهم",
      count: trainees.filter((trainee) => trainee.daysLeft < 0).length,
      text: "تم تجاوز تاريخ النهاية ويجب التعامل معها إداريًا بشكل مباشر.",
      tone: getStatusTone("منتهي"),
    },
  ];
}

function getDepartmentDistribution(traineesList = getAllTrainees()) {
  const distribution = getUniqueDepartments().map((department, index) => {
    return {
      label: department,
      value: traineesList.filter((trainee) => trainee.department === department).length,
      color: DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length],
    };
  });

  return distribution.sort((left, right) => right.value - left.value);
}

function getMonthlyCompletionData(traineesList = getAllTrainees()) {
  const months = [
    { key: "2026-04", label: "أبريل", color: "var(--chart-1)" },
    { key: "2026-05", label: "مايو", color: "var(--chart-2)" },
    { key: "2026-06", label: "يونيو", color: "var(--chart-3)" },
    { key: "2026-07", label: "يوليو", color: "var(--chart-4)" },
    { key: "2026-08", label: "أغسطس", color: "var(--chart-5)" },
    { key: "2026-09", label: "سبتمبر", color: "var(--chart-1)" },
  ];

  return months.map((month) => ({
    ...month,
    value: traineesList.filter((trainee) => trainee.endDate.startsWith(month.key)).length,
  }));
}

function getDashboardNearestTrainees() {
  return getDashboardScopedTrainees()
    .filter((trainee) => trainee.daysLeft >= 0)
    .sort((left, right) => left.daysLeft - right.daysLeft)
    .slice(0, 8);
}

function getPriorityRank(trainee) {
  switch (trainee.status) {
    case "عاجل":
      return 1;
    case "منتهي":
      return 2;
    case "بيانات ناقصة":
      return 3;
    case "قريب انتهاء":
      return 4;
    default:
      return 5;
  }
}

function getSortedPriorityItems() {
  return getDashboardScopedTrainees()
    .filter((trainee) => trainee.status !== "نشط")
    .filter((trainee) => !uiState.followedPriorityIds.includes(trainee.id))
    .sort((left, right) => {
      const priorityDifference = getPriorityRank(left) - getPriorityRank(right);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      if (left.daysLeft < 0 && right.daysLeft < 0) {
        return right.daysLeft - left.daysLeft;
      }

      if (left.daysLeft !== right.daysLeft) {
        return left.daysLeft - right.daysLeft;
      }

      return left.endDate.localeCompare(right.endDate);
    });
}

function getDashboardPriorityItems() {
  const priorities = getSortedPriorityItems();

  switch (uiState.dashboardPriorityTab) {
    case "urgent":
      return priorities.filter((trainee) => trainee.status === "عاجل");
    case "near":
      return priorities.filter((trainee) => trainee.status === "قريب انتهاء");
    case "expired":
      return priorities.filter((trainee) => trainee.status === "منتهي");
    case "missing":
      return priorities.filter((trainee) => trainee.status === "بيانات ناقصة");
    default:
      return priorities;
  }
}

function getAlertGroupForTrainee(trainee) {
  if (trainee.daysLeft < 0) {
    return "expired";
  }

  if (trainee.missingData) {
    return "missingData";
  }

  if (trainee.daysLeft <= 7) {
    return "within7";
  }

  return "within30";
}

function getDashboardInsightTrainees() {
  const allTrainees = getDashboardScopedTrainees();

  if (uiState.dashboardInsightDepartment === "all") {
    return allTrainees;
  }

  return allTrainees.filter(
    (trainee) => trainee.department === uiState.dashboardInsightDepartment,
  );
}

function getHeatmapData() {
  const statuses = ["نشط", "قريب انتهاء", "عاجل", "منتهي"];
  const trainees = getDashboardInsightTrainees();
  const departments =
    uiState.dashboardInsightDepartment === "all"
      ? [...new Set(trainees.map((trainee) => trainee.department))]
      : [uiState.dashboardInsightDepartment];

  return {
    statuses,
    rows: departments.map((department) => ({
      department,
      cells: statuses.map((status) => {
        const items = trainees.filter(
          (trainee) => trainee.department === department && trainee.status === status,
        );

        return {
          department,
          status,
          count: items.length,
          items,
        };
      }),
    })),
  };
}

function getForecastData() {
  const weeks = [
    { id: "week-1", label: "الأسبوع 1", min: 0, max: 7 },
    { id: "week-2", label: "الأسبوع 2", min: 8, max: 14 },
    { id: "week-3", label: "الأسبوع 3", min: 15, max: 21 },
    { id: "week-4", label: "الأسبوع 4", min: 22, max: 30 },
  ];

  return weeks.map((week) => {
    const items = getDashboardInsightTrainees()
      .filter((trainee) => trainee.daysLeft >= week.min && trainee.daysLeft <= week.max)
      .sort((left, right) => left.daysLeft - right.daysLeft);

    return {
      ...week,
      count: items.length,
      items,
    };
  });
}

function getDashboardFlowData() {
  const trainees = getDashboardInsightTrainees();
  const monthFormatter = new Intl.DateTimeFormat("ar-SA", { month: "short" });
  const monthKeys = [...new Set(trainees.map((trainee) => trainee.endDate.slice(0, 7)))].sort();
  const relevantMonthKeys = monthKeys.slice(0, 6);

  return relevantMonthKeys.map((monthKey) => {
    const date = new Date(`${monthKey}-01T00:00:00`);
    const items = trainees
      .filter((trainee) => trainee.endDate.startsWith(monthKey))
      .sort((left, right) => left.daysLeft - right.daysLeft);

    return {
      key: monthKey,
      label: monthFormatter.format(date),
      value: items.length,
      items,
    };
  });
}

function getDashboardStatusRingData() {
  const trainees = getDashboardInsightTrainees();
  const total = Math.max(trainees.length, 1);
  const segments = [
    {
      label: "نشط",
      count: trainees.filter((trainee) => trainee.status === "نشط").length,
      color: "var(--tone-success)",
    },
    {
      label: "قريب انتهاء",
      count: trainees.filter((trainee) => trainee.status === "قريب انتهاء").length,
      color: "var(--tone-info)",
    },
    {
      label: "عاجل",
      count: trainees.filter((trainee) => trainee.status === "عاجل").length,
      color: "var(--tone-warning)",
    },
    {
      label: "منتهي",
      count: trainees.filter((trainee) => trainee.status === "منتهي").length,
      color: "var(--tone-neutral)",
    },
  ];
  const activeCount = segments[0].count;
  const activeRatio = Math.round((activeCount / total) * 100);

  return {
    total: trainees.length,
    activeRatio,
    segments,
  };
}

function getDashboardExecutiveOverview() {
  const trainees = getDashboardScopedTrainees();
  const urgentCount = trainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 7).length;
  const expiringSoonCount = trainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30).length;
  const expiredCount = trainees.filter((trainee) => trainee.daysLeft < 0).length;
  const missingCount = trainees.filter((trainee) => trainee.missingData).length;
  const stableCount = trainees.filter((trainee) => trainee.status === "نشط").length;
  const attentionCount = trainees.length - stableCount;

  let headline = "الوضع مستقر ولا توجد قرارات عاجلة";
  let summary =
    `إجمالي ${formatNumber(trainees.length)} متدربًا، و${formatNumber(attentionCount)} حالات قيد المتابعة، دون أولويات حرجة خلال 7 أيام.`;

  if (urgentCount > 0) {
    headline =
      urgentCount === 1
        ? "حالة عاجلة بانتظار القرار"
        : urgentCount === 2
          ? "حالتان عاجلتان بانتظار القرار"
          : `${formatNumber(urgentCount)} حالات عاجلة بانتظار القرار`;
    summary =
      `إجمالي ${formatNumber(trainees.length)} متدربًا، و${formatNumber(attentionCount)} حالات قيد المتابعة، منها ${formatNumber(urgentCount)} حالات خلال 7 أيام.`;
  } else if (expiredCount > 0) {
    headline =
      expiredCount === 1
        ? "حالة منتهية بانتظار الإغلاق الإداري"
        : expiredCount === 2
          ? "حالتان منتهيتان بانتظار الإغلاق الإداري"
          : `${formatNumber(expiredCount)} حالات منتهية بانتظار الإغلاق الإداري`;
    summary =
      `إجمالي ${formatNumber(trainees.length)} متدربًا، و${formatNumber(attentionCount)} حالات قيد المتابعة، بينها ${formatNumber(expiredCount)} حالات منتهية تحتاج معالجة مباشرة.`;
  } else if (expiringSoonCount > 0) {
    headline =
      expiringSoonCount === 1
        ? "حالة قريبة من نهاية الفترة"
        : expiringSoonCount === 2
          ? "حالتان قريبتان من نهاية الفترة"
          : `${formatNumber(expiringSoonCount)} حالات قريبة من نهاية الفترة`;
    summary =
      `إجمالي ${formatNumber(trainees.length)} متدربًا، و${formatNumber(attentionCount)} حالات قيد المتابعة، بينها ${formatNumber(expiringSoonCount)} حالات ضمن نافذة 30 يوم.`;
  }

  return {
    total: trainees.length,
    urgentCount,
    expiringSoonCount,
    expiredCount,
    missingCount,
    stableCount,
    attentionCount,
    headline,
    summary,
  };
}

function getDashboardExecutiveMetrics() {
  const overview = getDashboardExecutiveOverview();

  return [
    {
      label: "إجمالي المتدربين",
      value: overview.total,
      detail: "الحجم الحالي لقاعدة المتابعة.",
      tone: "neutral",
      featured: true,
    },
    {
      label: "حالات تحتاج متابعة",
      value: overview.attentionCount,
      detail: "تشمل العاجلة والقريبة والمنتهية والناقصة.",
      tone: overview.attentionCount ? "warning" : "success",
    },
    {
      label: "خلال 7 أيام",
      value: overview.urgentCount,
      detail: "أولوية القرار الفوري.",
      tone: overview.urgentCount ? "warning" : "neutral",
    },
    {
      label: "ملفات ناقصة",
      value: overview.missingCount,
      detail: "تحتاج استكمالًا قبل الإغلاق.",
      tone: overview.missingCount ? "warning" : "neutral",
    },
  ];
}

function getDashboardExecutiveDepartmentFocus() {
  const trainees = getDashboardScopedTrainees();
  const departments = [...new Set(trainees.map((trainee) => trainee.department))];

  return departments
    .map((department) => {
      const items = trainees.filter((trainee) => trainee.department === department);
      const urgentCount = items.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 7).length;
      const attentionCount = items.filter((trainee) => trainee.status !== "نشط").length;
      const missingCount = items.filter((trainee) => trainee.missingData).length;
      const expiringSoonCount = items.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30).length;

      return {
        department,
        total: items.length,
        urgentCount,
        attentionCount,
        missingCount,
        expiringSoonCount,
      };
    })
    .filter((item) => item.total > 0)
    .sort((left, right) => {
      if (right.urgentCount !== left.urgentCount) {
        return right.urgentCount - left.urgentCount;
      }

      if (right.attentionCount !== left.attentionCount) {
        return right.attentionCount - left.attentionCount;
      }

      return right.total - left.total;
    })
    .slice(0, 3);
}

function getDashboardExecutiveActionItems() {
  return getSortedPriorityItems().slice(0, 3);
}

function getDashboardExecutiveRouteCards() {
  const overview = getDashboardExecutiveOverview();

  return [
    {
      label: "التنبيهات",
      value: overview.attentionCount,
      detail: "الحالات التي تحتاج تدخلًا مباشرًا.",
      view: "alerts",
    },
    {
      label: "المتدربين",
      value: overview.total,
      detail: "الملفات الفردية والبيانات التشغيلية.",
      view: "trainees",
    },
    {
      label: "التقارير",
      value: overview.expiringSoonCount,
      detail: "المؤشرات الرسمية والتوزيعات المجملة.",
      view: "reports",
    },
  ];
}

function getSupervisorLoadData() {
  const groupedBySupervisor = new Map();

  getDashboardInsightTrainees().forEach((trainee) => {
    if (!groupedBySupervisor.has(trainee.supervisor)) {
      groupedBySupervisor.set(trainee.supervisor, []);
    }

    groupedBySupervisor.get(trainee.supervisor).push(trainee);
  });

  return [...groupedBySupervisor.entries()]
    .map(([supervisor, trainees]) => {
      const sortedTrainees = [...trainees].sort((left, right) => left.daysLeft - right.daysLeft);
      const criticalItems = sortedTrainees.filter((trainee) =>
        ["عاجل", "منتهي", "بيانات ناقصة"].includes(trainee.status),
      );

      return {
        supervisor,
        total: sortedTrainees.length,
        criticalCount: criticalItems.length,
        items: sortedTrainees,
        previewTrainee: criticalItems[0] || sortedTrainees[0],
      };
    })
    .sort((left, right) => {
      if (right.criticalCount !== left.criticalCount) {
        return right.criticalCount - left.criticalCount;
      }

      return right.total - left.total;
    });
}

function getMeetingActionItems() {
  return getSortedPriorityItems()
    .filter((trainee) => {
      if (uiState.dashboardInsightDepartment === "all") {
        return true;
      }

      return trainee.department === uiState.dashboardInsightDepartment;
    })
    .slice(0, 5);
}

function getHeatmapCellTone(status, count) {
  const intensity = count === 0 ? 0.04 : Math.min(0.12 + count * 0.04, 0.36);
  const mixPercent = Math.round(Math.min(intensity * 190, 72));

  switch (status) {
    case "نشط":
      return {
        background: `color-mix(in srgb, var(--tone-success-soft) ${mixPercent}%, transparent)`,
        color: "var(--tone-success)",
      };
    case "قريب انتهاء":
      return {
        background: `color-mix(in srgb, var(--tone-info-soft) ${mixPercent}%, transparent)`,
        color: "var(--tone-info)",
      };
    case "عاجل":
      return {
        background: `color-mix(in srgb, var(--tone-warning-soft) ${Math.min(mixPercent + 8, 78)}%, transparent)`,
        color: "var(--tone-warning)",
      };
    default:
      return {
        background: `color-mix(in srgb, var(--tone-neutral-soft) ${Math.min(mixPercent + 6, 74)}%, transparent)`,
        color: "var(--tone-neutral)",
      };
  }
}

function filterTraineesDirectory() {
  const normalizedQuery = uiState.traineesFilters.search.trim().toLowerCase();

  return getAllTrainees().filter((trainee) => {
    const matchesSearch =
      !normalizedQuery ||
      [trainee.name, trainee.department, trainee.supervisor, trainee.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    const matchesDepartment =
      uiState.traineesFilters.department === "all" ||
      trainee.department === uiState.traineesFilters.department;

    const matchesStatus =
      uiState.traineesFilters.status === "all" || trainee.status === uiState.traineesFilters.status;

    const matchesRemaining = (() => {
      switch (uiState.traineesFilters.remaining) {
        case "lt7":
          return trainee.daysLeft >= 0 && trainee.daysLeft <= 7;
        case "lt30":
          return trainee.daysLeft >= 0 && trainee.daysLeft <= 30;
        case "gt30":
          return trainee.daysLeft > 30;
        case "expired":
          return trainee.daysLeft < 0;
        default:
          return true;
      }
    })();

    return matchesSearch && matchesDepartment && matchesStatus && matchesRemaining;
  });
}

function getSelectedTrainee() {
  const trainees = getAllTrainees();
  return trainees.find((trainee) => trainee.id === uiState.selectedTraineeId) || trainees[0];
}

function getAlertsData() {
  const normalizedQuery = uiState.alertSearch.trim().toLowerCase();
  const allTrainees = getAllTrainees();
  const applySearch = (trainees) =>
    trainees.filter((trainee) => {
      if (!normalizedQuery) {
        return true;
      }

      return [trainee.name, trainee.department, trainee.status, trainee.supervisor]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

  return {
    within7: applySearch(allTrainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 7)),
    within30: applySearch(allTrainees.filter((trainee) => trainee.daysLeft >= 8 && trainee.daysLeft <= 30)),
    missingData: applySearch(allTrainees.filter((trainee) => trainee.missingData)),
    expired: applySearch(allTrainees.filter((trainee) => trainee.daysLeft < 0)),
  };
}

function getNotificationTone(type) {
  switch (type) {
    case "expired":
      return getStatusTone("منتهي");
    case "urgent":
      return getStatusTone("عاجل");
    case "missingData":
      return getStatusTone("بيانات ناقصة");
    default:
      return getStatusTone("قريب انتهاء");
  }
}

function getNotificationEntries() {
  const priorityWeight = {
    expired: 0,
    urgent: 1,
    missingData: 2,
    upcoming: 3,
  };

  return getAllTrainees()
    .map((trainee) => {
      if (trainee.daysLeft < 0) {
        return {
          id: `expired-${trainee.id}`,
          traineeId: trainee.id,
          alertGroup: "expired",
          type: "expired",
          title: `${trainee.name} انتهت فترته التدريبية`,
          meta: `${trainee.department} • يلزم إغلاق الملف أو اعتماد الإشعار.`,
          timeLabel: `منتهٍ منذ ${formatNumber(Math.abs(trainee.daysLeft))} يوم`,
          tone: getNotificationTone("expired"),
          sortWeight: priorityWeight.expired,
          sortValue: trainee.daysLeft,
        };
      }

      if (trainee.daysLeft <= 7) {
        return {
          id: `urgent-${trainee.id}`,
          traineeId: trainee.id,
          alertGroup: "within7",
          type: "urgent",
          title: `${trainee.name} على وشك الانتهاء`,
          meta: `${trainee.department} • يحتاج متابعة مباشرة قبل نهاية الفترة.`,
          timeLabel: getRemainingDaysLabel(trainee.daysLeft),
          tone: getNotificationTone("urgent"),
          sortWeight: priorityWeight.urgent,
          sortValue: trainee.daysLeft,
        };
      }

      if (trainee.missingData) {
        return {
          id: `missing-${trainee.id}`,
          traineeId: trainee.id,
          alertGroup: "missingData",
          type: "missingData",
          title: `${trainee.name} لديه بيانات ناقصة`,
          meta: `${trainee.department} • يلزم استكمال المستندات والحقول الناقصة.`,
          timeLabel: "تحتاج معالجة",
          tone: getNotificationTone("missingData"),
          sortWeight: priorityWeight.missingData,
          sortValue: trainee.daysLeft,
        };
      }

      if (trainee.daysLeft <= 30) {
        return {
          id: `upcoming-${trainee.id}`,
          traineeId: trainee.id,
          alertGroup: "within30",
          type: "upcoming",
          title: `${trainee.name} سيدخل نطاق المتابعة قريبًا`,
          meta: `${trainee.department} • يستحسن تجهيز الإجراء قبل نهاية المدة.`,
          timeLabel: getRemainingDaysLabel(trainee.daysLeft),
          tone: getNotificationTone("upcoming"),
          sortWeight: priorityWeight.upcoming,
          sortValue: trainee.daysLeft,
        };
      }

      return null;
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.sortWeight !== right.sortWeight) {
        return left.sortWeight - right.sortWeight;
      }

      if (left.sortWeight === priorityWeight.expired) {
        return left.sortValue - right.sortValue;
      }

      return left.sortValue - right.sortValue;
    });
}

function renderNotificationCenter() {
  const notificationShell = document.getElementById("notification-shell");
  const toggleButton = document.getElementById("notifications-toggle");
  const backdrop = document.getElementById("notifications-backdrop");
  const badge = document.getElementById("notifications-badge");
  const summary = document.getElementById("notifications-summary");
  const count = document.getElementById("notifications-count");
  const panel = document.getElementById("notifications-panel");
  const list = document.getElementById("notifications-list");

  if (!notificationShell || !toggleButton || !backdrop || !badge || !summary || !count || !panel || !list) {
    return;
  }

  const entries = getNotificationEntries();
  const totalCount = entries.length;
  const previewItems = entries.slice(0, 6);

  summary.textContent = totalCount
    ? `${formatNumber(totalCount)} إشعار يحتاج متابعة`
    : "لا توجد إشعارات جديدة";
  count.textContent = totalCount > 99 ? "99+" : formatNumber(totalCount);

  toggleButton.setAttribute("aria-expanded", String(uiState.notificationsOpen));
  toggleButton.setAttribute("aria-label", summary.textContent);
  toggleButton.setAttribute("title", summary.textContent);
  notificationShell.classList.toggle("notification-shell--open", uiState.notificationsOpen);
  panel.classList.toggle("notification-panel--open", uiState.notificationsOpen);
  backdrop.classList.toggle("notification-backdrop--open", uiState.notificationsOpen);

  if (totalCount) {
    badge.hidden = false;
    badge.textContent = totalCount > 9 ? "9+" : formatNumber(totalCount);
  } else {
    badge.hidden = true;
  }

  backdrop.hidden = !uiState.notificationsOpen;
  panel.hidden = !uiState.notificationsOpen;
  panel.setAttribute("aria-hidden", String(!uiState.notificationsOpen));

  list.innerHTML = previewItems.length
    ? previewItems
        .map(
          (entry) => `
            <button
              class="notification-item"
              type="button"
              data-notification-action="open-item"
              data-alert-group="${entry.alertGroup}"
              data-trainee-id="${entry.traineeId}"
            >
              <span class="notification-item__dot" style="color:${entry.tone.color}; background:${entry.tone.color}"></span>
              <span class="notification-item__body">
                <strong class="notification-item__title">${escapeHtml(entry.title)}</strong>
                <span class="notification-item__meta">${escapeHtml(entry.meta)}</span>
              </span>
              <span class="notification-item__time">${escapeHtml(entry.timeLabel)}</span>
            </button>
          `,
        )
        .join("")
    : `<div class="notification-empty">كل الحالات مستقرة حاليًا، ولا توجد عناصر جديدة داخل مركز الإشعارات.</div>`;
}

function filterReportTrainees() {
  return getAllTrainees().filter((trainee) => {
    const matchesSearch =
      !uiState.reportSearch.trim() ||
      [trainee.name, trainee.department, trainee.supervisor, trainee.status]
        .join(" ")
        .toLowerCase()
        .includes(uiState.reportSearch.trim().toLowerCase());

    const matchesDepartment =
      uiState.reportFilters.department === "all" ||
      trainee.department === uiState.reportFilters.department;

    const matchesStatus =
      uiState.reportFilters.status === "all" || trainee.status === uiState.reportFilters.status;

    const matchesPeriod = (() => {
      switch (uiState.reportFilters.period) {
        case "30":
          return trainee.daysLeft >= 0 && trainee.daysLeft <= 30;
        case "90":
          return trainee.daysLeft >= 0 && trainee.daysLeft <= 90;
        case "month":
          return trainee.endDate.startsWith("2026-04");
        case "expired":
          return trainee.daysLeft < 0;
        default:
          return true;
      }
    })();

    return matchesSearch && matchesDepartment && matchesStatus && matchesPeriod;
  });
}

function renderStatusBadge(status, tone) {
  return `
    <span class="status-badge ${tone.className || ""}">
      ${status}
    </span>
  `;
}

function getRemainingDaysLabel(daysLeft) {
  if (daysLeft < 0) {
    return `منتهٍ منذ ${formatNumber(Math.abs(daysLeft))} يوم`;
  }

  return `باقي ${formatNumber(daysLeft)} أيام`;
}

function getNextMockStatus(currentStatus) {
  const statusOrder = ["نشط", "قريب انتهاء", "عاجل", "منتهي"];
  const currentIndex = statusOrder.indexOf(currentStatus);

  if (currentIndex === -1 || currentIndex === statusOrder.length - 1) {
    return statusOrder[0];
  }

  return statusOrder[currentIndex + 1];
}

function getIndicatorTonePalette(toneId) {
  return INDICATOR_TONES[toneId] || INDICATOR_TONES.cyan;
}

function formatIndicatorsMetric(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  const numericValue = Number(value);

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(numericValue) >= 100 ? 0 : 1,
  }).format(numericValue);
}

function formatIndicatorsPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }

  return `${Math.round(Number(value))}%`;
}

function formatIndicatorsProcessingMode(mode) {
  switch (mode) {
    case "heavy":
      return "عالي";
    case "elevated":
      return "متوسط";
    case "full":
      return "كامل";
    default:
      return "--";
  }
}

function getChartScale(values) {
  const maxValue = Math.max(...values.map((value) => Number(value) || 0), 1);
  return maxValue;
}

function buildLineChartPaths(points, key = "primary", width = 420, height = 178) {
  if (!points.length) {
    return null;
  }

  const paddingX = 20;
  const paddingY = 18;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const maxValue = getChartScale(points.map((point) => point[key]));
  const step = points.length > 1 ? usableWidth / (points.length - 1) : usableWidth / 2;

  const coordinates = points.map((point, index) => {
    const x = paddingX + step * index;
    const y = height - paddingY - ((Number(point[key]) || 0) / maxValue) * usableHeight;
    return { x, y, label: point.label, value: Number(point[key]) || 0 };
  });

  const path = coordinates
    .map((coordinate, index) => `${index === 0 ? "M" : "L"} ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`)
    .join(" ");

  const area = `${path} L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${(height - paddingY).toFixed(2)} L ${coordinates[0].x.toFixed(2)} ${(height - paddingY).toFixed(2)} Z`;

  return {
    coordinates,
    path,
    area,
    width,
    height,
    baseline: height - paddingY,
  };
}

function renderIndicatorsUploadShell() {
  const uploadState = uiState.indicatorsUploadState;
  const analysis = uiState.indicatorsAnalysis;
  const validation = analysis?.validation;
  const meta = analysis?.meta;
  const statusMeta = getIndicatorsAnalysisStatusMeta(analysis);
  const fileLabel =
    uploadState === "uploading"
      ? "جارٍ تجهيز النتيجة"
      : analysis
        ? "تم تجهيز النتيجة"
        : uiState.indicatorsUploadName
          ? "ملف جاهز"
          : "اختر ملفًا للرفع";
  const statusText =
    uploadState === "uploading"
      ? "جارٍ تحليل الملف وإعداد الملخص الإداري..."
      : uploadState === "error"
        ? uiState.indicatorsUploadError || "تعذر تحليل الملف."
        : analysis && validation?.needsReview
          ? "تم تجهيز قراءة أولية مع توصية بالمراجعة قبل الاعتماد."
        : analysis
            ? "النتيجة جاهزة وتظهر أسفل الصفحة بصيغة إدارية مختصرة."
          : "ارفع ملف Excel أو CSV وسيظهر لك ملخص واضح خلال ثوانٍ.";

  return `
    <section class="card section-block section-block--indicators-upload">
      <div class="section-heading section-heading--start">
        <div>
          <h3 class="section-title">رفع ملف التحليل</h3>
          <p class="section-subtitle">ارفع الملف وسيتم تجهيز نتيجة إدارية مبسطة ثم التفاصيل الفنية عند الحاجة.</p>
        </div>
        <div class="indicators-upload-actions">
          <label class="action-button action-button--primary indicators-upload-action${uploadState === "uploading" ? " indicators-upload-action--disabled" : ""}" for="indicators-file-input">
            ${uploadState === "uploading" ? "جارٍ التحليل..." : "رفع ملف Excel"}
          </label>
          ${
            analysis
              ? `
                <button class="action-button action-button--ghost" type="button" data-action="clear-indicators-analysis">
                  مسح النتائج
                </button>
              `
              : ""
          }
        </div>
      </div>

      <div class="indicators-upload-grid">
        <label class="indicators-dropzone indicators-dropzone--${uploadState}" for="indicators-file-input">
          <input id="indicators-file-input" class="indicators-file-input" type="file" accept=".xlsx,.xls,.csv" />
          <span class="indicators-dropzone__eyebrow">رفع البيانات</span>
          <strong class="indicators-dropzone__title">${fileLabel}</strong>
          <span class="indicators-dropzone__text">${statusText}</span>
          <span class="indicators-dropzone__formats"><code>.xlsx</code> <code>.xls</code> <code>.csv</code></span>
        </label>

        <div class="indicators-trust-card indicators-trust-card--admin">
          <div class="indicators-trust-card__top">
            <span class="indicators-trust-card__eyebrow">${analysis ? "آخر نتيجة" : "ماذا سيظهر لك؟"}</span>
            <strong class="indicators-trust-card__score">${analysis ? statusMeta.label : "ملخص سريع"}</strong>
          </div>
          <div class="indicators-trust-list">
            ${
              analysis
                ? `
                  <span>الورقة: ${escapeHtml(meta?.sheetName || "--")}</span>
                  <span>السجلات: ${escapeHtml(formatIndicatorsMetric(meta?.rowCount))}</span>
                  <span>الأعمدة: ${escapeHtml(formatIndicatorsMetric(meta?.columnCount))}</span>
                  <span>الجودة: ${escapeHtml(formatIndicatorsPercent(validation?.qualityScore))}</span>
                `
                : `
                  <span>اسم الورقة المعتمدة</span>
                  <span>عدد الصفوف والأعمدة</span>
                  <span>حالة التحليل بوضوح</span>
                  <span>ملخص تنفيذي وتوصية</span>
                `
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function getIndicatorsExperimentMeta(result) {
  return result?.meta || {};
}

function getIndicatorsExperimentValidation(result) {
  return result?.validation || {};
}

function renderIndicatorsExperimentList(items, emptyMessage, itemClassName = "") {
  if (!items?.length) {
    return `<div class="indicators-api-result__list-empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return items
    .map(
      (item) => `
        <div class="indicators-api-result__list-item${itemClassName ? ` ${itemClassName}` : ""}">
          ${escapeHtml(String(item))}
        </div>
      `,
    )
    .join("");
}

function renderIndicatorsApiExperimentPanel(result) {
  const state = uiState.indicatorsApiExperimentState;
  const error = uiState.indicatorsApiExperimentError;
  const meta = getIndicatorsExperimentMeta(result);
  const validation = getIndicatorsExperimentValidation(result);
  const warnings = [...(meta.warnings || []), ...(validation.warnings || [])];
  const errors = validation.errors || [];
  const selectedSheet = meta.selected_sheet;
  const selectedHeaderRow = meta.selected_header_row;
  const sheetNames = meta.sheet_names || [];
  const filename = meta.filename || uiState.indicatorsSelectedFile?.name || "--";
  const rowCount = meta.row_count ?? meta.row_count_raw ?? null;
  const columnCount = meta.column_count ?? (meta.column_names_raw || []).length ?? null;
  const qualityScore = validation.quality_score ?? null;
  const confidencePercent =
    validation.confidence === null || validation.confidence === undefined
      ? null
      : Number(validation.confidence) * 100;

  let statusText = "اختر ملفًا ثم اضغط تجربة تحليل API لعرض نتيجة FastAPI هنا.";
  if (state === "uploading") {
    statusText = "جارٍ تحليل الملف...";
  } else if (state === "error") {
    statusText = error || "فشل الاتصال بخدمة التحليل";
  } else if (state === "ready") {
    statusText = selectedSheet
      ? "تمت إعادة نتيجة FastAPI التجريبية بنجاح."
      : "وصلت نتيجة من الخدمة لكن لم يتم اعتماد Sheet واضح بعد.";
  }

  return `
    <section class="card section-block section-block--indicators-api-result">
      <div class="section-heading section-heading--start">
        <div>
          <h3 class="section-title">نتيجة تجربة API</h3>
          <p class="section-subtitle">مسار تجريبي مستقل لخدمة FastAPI الجديدة بدون التأثير على التحليل الحالي.</p>
        </div>
      </div>

      <div class="indicators-api-result indicators-api-result--${state}">
        <div class="indicators-api-result__hero">
          <strong class="indicators-api-result__title">${escapeHtml(filename)}</strong>
          <p class="indicators-api-result__status">${escapeHtml(statusText)}</p>
        </div>

        <div class="indicators-api-result__grid">
          <div class="indicators-api-result__facts">
            <div class="indicators-api-result__fact">
              <span>اسم الملف</span>
              <strong>${escapeHtml(filename)}</strong>
            </div>
            <div class="indicators-api-result__fact">
              <span>الشيت المختار</span>
              <strong>${escapeHtml(selectedSheet || "--")}</strong>
            </div>
            <div class="indicators-api-result__fact">
              <span>صف العنوان</span>
              <strong>${escapeHtml(selectedHeaderRow ?? "--")}</strong>
            </div>
            <div class="indicators-api-result__fact">
              <span>عدد الصفوف</span>
              <strong>${escapeHtml(formatIndicatorsMetric(rowCount))}</strong>
            </div>
            <div class="indicators-api-result__fact">
              <span>عدد الأعمدة</span>
              <strong>${escapeHtml(formatIndicatorsMetric(columnCount))}</strong>
            </div>
            <div class="indicators-api-result__fact">
              <span>الجودة</span>
              <strong>${escapeHtml(formatIndicatorsPercent(qualityScore))}</strong>
            </div>
            <div class="indicators-api-result__fact">
              <span>الثقة</span>
              <strong>${escapeHtml(formatIndicatorsPercent(confidencePercent))}</strong>
            </div>
          </div>

          <div class="indicators-api-result__assistant">
            <div class="indicators-api-result__assistant-block">
              <span>العنوان التنفيذي</span>
              <strong>${escapeHtml(result?.assistant?.headline || "--")}</strong>
            </div>
            <div class="indicators-api-result__assistant-block">
              <span>الملخص</span>
              <p>${escapeHtml(result?.assistant?.summary || "")}</p>
            </div>
          </div>
        </div>

        ${
          !selectedSheet && sheetNames.length
            ? `
              <div class="indicators-api-result__secondary">
                <h4>الأوراق المتاحة</h4>
                <div class="indicators-api-result__tags">
                  ${sheetNames.map((sheetName) => `<span>${escapeHtml(sheetName)}</span>`).join("")}
                </div>
              </div>
            `
            : ""
        }

        <div class="indicators-api-result__lists">
          <div class="indicators-api-result__list">
            <h4>التحذيرات</h4>
            ${renderIndicatorsExperimentList(warnings, "لا توجد تحذيرات حالية.")}
          </div>
          <div class="indicators-api-result__list">
            <h4>الأخطاء</h4>
            ${renderIndicatorsExperimentList(errors, "لا توجد أخطاء حالية.", "indicators-api-result__list-item--error")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function getIndicatorsAnalysisStatusMeta(analysis) {
  const validation = analysis?.validation;

  if (!analysis || !validation) {
    return {
      label: "بانتظار الرفع",
      tone: "neutral",
      description: "لا توجد نتيجة بعد. ارفع ملفًا لبدء التحليل.",
    };
  }

  if (Array.isArray(validation.errors) && validation.errors.length) {
    return {
      label: "يحتاج مراجعة",
      tone: "warning",
      description: "تمت القراءة لكن توجد أخطاء أو نواقص تمنع الاعتماد المباشر.",
    };
  }

  if (validation.needsReview || !validation.ready) {
    return {
      label: "يحتاج مراجعة",
      tone: "warning",
      description: "النتيجة جاهزة كقراءة أولية مع ملاحظات تستحق المتابعة.",
    };
  }

  return {
    label: "ناجح",
    tone: "success",
    description: "تم تجهيز قراءة واضحة ويمكن البدء بالمراجعة الإدارية مباشرة.",
  };
}

function getIndicatorsPrimaryRecommendation(analysis) {
  const assistantActions = analysis?.assistant?.actions || [];
  const warnings = analysis?.validation?.warnings || [];
  const errors = analysis?.validation?.errors || [];

  return (
    assistantActions[0] ||
    errors[0] ||
    warnings[0] ||
    "يمكن اعتماد النتيجة الحالية والانتقال إلى المراجعة التفصيلية عند الحاجة."
  );
}

function renderIndicatorsExecutiveCards(analysis) {
  const meta = analysis?.meta || {};
  const statusMeta = getIndicatorsAnalysisStatusMeta(analysis);
  const cards = [
    {
      label: "اسم الورقة",
      value: meta.sheetName || "--",
      detail: "الورقة التي اعتمدها النظام في القراءة الحالية.",
    },
    {
      label: "عدد الصفوف",
      value: formatIndicatorsMetric(meta.rowCount),
      detail: "السجلات التي دخلت في التحليل النهائي.",
    },
    {
      label: "عدد الأعمدة",
      value: formatIndicatorsMetric(meta.columnCount),
      detail: "الأعمدة المقروءة بعد تجهيز الملف.",
    },
    {
      label: "حالة التحليل",
      value: statusMeta.label,
      detail: statusMeta.description,
      tone: statusMeta.tone,
    },
  ];

  return cards
    .map(
      (card) => `
        <article class="indicators-admin-card${card.tone ? ` indicators-admin-card--${card.tone}` : ""}">
          <span class="indicators-admin-card__label">${escapeHtml(card.label)}</span>
          <strong class="indicators-admin-card__value">${escapeHtml(card.value || "--")}</strong>
          <p class="indicators-admin-card__detail">${escapeHtml(card.detail || "")}</p>
        </article>
      `,
    )
    .join("");
}

function renderIndicatorsTechnicalList(items, emptyMessage, itemClassName = "") {
  if (!items?.length) {
    return `<div class="indicators-technical-list__empty">${escapeHtml(emptyMessage)}</div>`;
  }

  return items
    .map(
      (item) => `
        <div class="indicators-technical-list__item${itemClassName ? ` ${itemClassName}` : ""}">
          ${escapeHtml(String(item))}
        </div>
      `,
    )
    .join("");
}

function renderIndicatorsTechnicalDetails(analysis) {
  const validation = analysis?.validation || {};
  const meta = analysis?.meta || {};
  const experimentState = uiState.indicatorsApiExperimentState;
  const hasSelectedFile = Boolean(uiState.indicatorsSelectedFile);
  const experimentVisible =
    experimentState !== "idle" ||
    Boolean(uiState.indicatorsApiExperimentResult) ||
    Boolean(uiState.indicatorsApiExperimentError);
  const selectedHeaderRow =
    meta.headerRow ?? getIndicatorsExperimentMeta(uiState.indicatorsApiExperimentResult).selected_header_row ?? "--";
  const rawPayload = {
    backendAnalysis: analysis || null,
    fastApiExperiment: uiState.indicatorsApiExperimentResult || null,
  };

  return `
    <details class="indicators-disclosure indicators-disclosure--technical">
      <summary class="indicators-disclosure__summary">
        <div>
          <strong>التفاصيل التقنية</strong>
          <span>مخصصة للمطور أو للمراجعة الفنية عند الحاجة فقط.</span>
        </div>
      </summary>
      <div class="indicators-disclosure__content">
        <div class="indicators-technical-grid">
          <article class="indicators-technical-card">
            <span>confidence</span>
            <strong>${escapeHtml(formatIndicatorsPercent((validation.confidence || 0) * 100))}</strong>
          </article>
          <article class="indicators-technical-card">
            <span>selected_header_row</span>
            <strong>${escapeHtml(String(selectedHeaderRow))}</strong>
          </article>
          <article class="indicators-technical-card">
            <span>processing mode</span>
            <strong>${escapeHtml(formatIndicatorsProcessingMode(validation?.preflight?.processingMode))}</strong>
          </article>
          <article class="indicators-technical-card">
            <span>selection score</span>
            <strong>${escapeHtml(formatIndicatorsPercent(meta.selectionScore))}</strong>
          </article>
        </div>

        <div class="indicators-technical-lists">
          <div class="indicators-technical-list">
            <h4>warnings</h4>
            ${renderIndicatorsTechnicalList(validation.warnings, "لا توجد تحذيرات حالية.")}
          </div>
          <div class="indicators-technical-list">
            <h4>errors</h4>
            ${renderIndicatorsTechnicalList(validation.errors, "لا توجد أخطاء حالية.", "indicators-technical-list__item--error")}
          </div>
        </div>

        <div class="indicators-technical-tools">
          <button
            class="action-button action-button--ghost indicators-upload-action${!hasSelectedFile || experimentState === "uploading" ? " indicators-upload-action--disabled" : ""}"
            type="button"
            data-action="test-indicators-api"
          >
            ${experimentState === "uploading" ? "جارٍ تحليل FastAPI..." : "تجربة FastAPI مباشرة"}
          </button>
          <button class="action-button action-button--ghost" type="button" data-action="export-indicators-powerbi">
            تصدير Power BI
          </button>
        </div>

        ${
          experimentVisible
            ? `
              <div class="indicators-technical-experiment">
                ${renderIndicatorsApiExperimentPanel(uiState.indicatorsApiExperimentResult)}
              </div>
            `
            : ""
        }

        <div class="indicators-raw-block">
          <div class="indicators-raw-block__head">
            <h4>raw API data</h4>
            <span>الاستجابة الخام الحالية من المسار الخلفي.</span>
          </div>
          <pre class="indicators-raw-block__json">${escapeHtml(JSON.stringify(rawPayload, null, 2))}</pre>
        </div>
      </div>
    </details>
  `;
}

function renderIndicatorsDetailedAnalysis(analysis) {
  const dashboard = analysis?.dashboard;
  const assistant = analysis?.assistant;

  return `
    <details class="indicators-disclosure">
      <summary class="indicators-disclosure__summary">
        <div>
          <strong>القراءة التفصيلية</strong>
          <span>رسوم ولوحات إضافية للاستخدام التحليلي بعد الاطلاع على الملخص التنفيذي.</span>
        </div>
      </summary>
      <div class="indicators-disclosure__content">
        <div class="indicators-workbench">
          ${renderIndicatorsAssistantPanel(assistant)}
          <div class="indicators-kpi-grid">
            ${renderIndicatorsKpiCards(dashboard?.cards || [])}
          </div>
          <div class="indicators-board-grid">
            ${renderIndicatorsLinePanel(dashboard?.trend, "indicators-panel--trend")}
            ${renderIndicatorsRingPanel(dashboard?.ringMetric)}
            ${renderIndicatorsColumnsPanel(dashboard?.peakChart)}
            ${renderIndicatorsDonutPanel(dashboard?.distribution)}
            ${renderIndicatorsComparisonPanel(dashboard?.comparison)}
            ${renderIndicatorsRadarPanel(dashboard?.radar)}
            ${renderIndicatorsRankingPanel(dashboard?.ranking)}
            ${renderIndicatorsLinePanel(dashboard?.averageChart, "indicators-panel--average")}
            ${renderIndicatorsFieldQualityPanel(dashboard?.fieldQuality)}
          </div>
        </div>
      </div>
    </details>
  `;
}

function renderIndicatorsEmptyState() {
  return `
    <section class="card section-block section-block--indicators-empty">
      <div class="indicators-empty-state">
        <span class="indicators-empty-state__eyebrow">لوحة المؤشرات</span>
        <h3 class="indicators-empty-state__title">ارفع ملفك لتظهر النتيجة الإدارية هنا</h3>
        <p class="indicators-empty-state__text">
          ستظهر لك أولًا نتيجة سريعة تتضمن حالة التحليل والملخص التنفيذي والتوصية، ثم يمكنك فتح القراءة التفصيلية أو التفاصيل التقنية عند الحاجة.
        </p>
      </div>
    </section>
  `;
}

function renderIndicatorsKpiCards(cards) {
  return cards
    .map((card) => {
      const palette = getIndicatorTonePalette(card.tone);

      return `
        <article
          class="indicators-kpi-card"
          style="--indicator-accent:${palette.accent}; --indicator-glow:${palette.glow}; --indicator-progress:${Math.max(0, Math.min(Number(card.progress) || 0, 100))}%;"
        >
          <div class="indicators-kpi-card__copy">
            <p class="indicators-kpi-card__title">${escapeHtml(card.title)}</p>
            <div class="indicators-kpi-card__meta">
              <span>${escapeHtml(card.referenceLabel)}</span>
              <strong>${escapeHtml(card.referenceValue)}</strong>
            </div>
            <strong class="indicators-kpi-card__value">${escapeHtml(card.actualDisplay)}</strong>
            ${card.description ? `<p class="indicators-kpi-card__description">${escapeHtml(card.description)}</p>` : ""}
          </div>
          <div class="indicators-kpi-card__progress">
            <div class="indicators-kpi-card__ring">
              <span>${escapeHtml(card.progressDisplay)}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderIndicatorsFallbackPanel(title, subtitle) {
  return `
    <div class="indicators-panel indicators-panel--empty">
      <h4 class="indicators-panel__title">${escapeHtml(title)}</h4>
      <p class="indicators-panel__subtitle">${escapeHtml(subtitle)}</p>
    </div>
  `;
}

function renderIndicatorsTooltipAttr(text) {
  return text ? ` data-tooltip="${escapeHtml(text)}"` : "";
}

function renderIndicatorsLinePanel(chart, modifier = "") {
  if (!chart?.points?.length) {
    return renderIndicatorsFallbackPanel(chart?.title || "الرسم غير متاح", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  const geometry = buildLineChartPaths(chart.points, "primary");
  if (!geometry) {
    return renderIndicatorsFallbackPanel(chart?.title || "الرسم غير متاح", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  return `
    <div class="indicators-panel ${modifier}">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(chart.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(chart.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-line-chart">
        <svg viewBox="0 0 ${geometry.width} ${geometry.height}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="indicators-line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="var(--indicators-chart-1)"></stop>
              <stop offset="50%" stop-color="var(--indicators-chart-2)"></stop>
              <stop offset="100%" stop-color="var(--indicators-chart-3)"></stop>
            </linearGradient>
            <linearGradient id="indicators-area-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="color-mix(in srgb, var(--indicators-chart-2) 30%, transparent)"></stop>
              <stop offset="100%" stop-color="color-mix(in srgb, var(--indicators-chart-2) 4%, transparent)"></stop>
            </linearGradient>
          </defs>
          <path class="indicators-line-chart__area" d="${geometry.area}"></path>
          <path class="indicators-line-chart__path" d="${geometry.path}"></path>
          ${geometry.coordinates
            .map(
              (coordinate, index) => `
                <circle class="indicators-line-chart__point" cx="${coordinate.x}" cy="${coordinate.y}" r="4.2">
                  <title>${escapeHtml(`${chart.points[index].label}: ${formatIndicatorsMetric(chart.points[index].primary)}${chart.secondaryLabel && chart.points[index].secondary != null ? ` | ${chart.secondaryLabel}: ${formatIndicatorsMetric(chart.points[index].secondary)}` : ""}`)}</title>
                </circle>
              `,
            )
            .join("")}
        </svg>
        <div class="indicators-line-chart__labels">
          ${chart.points
            .map(
              (point) => `
                <div class="indicators-line-chart__label">
                  <strong>${escapeHtml(point.label)}</strong>
                  <span>${escapeHtml(formatIndicatorsMetric(point.primary))}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderIndicatorsRingPanel(metric) {
  if (!metric) {
    return renderIndicatorsFallbackPanel("ثقة التحليل", "لا توجد بيانات كافية.");
  }

  return `
    <div class="indicators-panel indicators-panel--ring">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(metric.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(metric.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-ring">
        <div class="indicators-ring__chart" style="--indicator-progress:${Math.max(0, Math.min(Number(metric.value) || 0, 100))}%;">
          <div class="indicators-ring__center">
            <strong>${escapeHtml(metric.display)}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderIndicatorsColumnsPanel(chart) {
  if (!chart?.points?.length) {
    return renderIndicatorsFallbackPanel(chart?.title || "القمم غير متاحة", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  const maxValue = getChartScale(chart.points.map((point) => point.primary));

  return `
    <div class="indicators-panel indicators-panel--columns">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(chart.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(chart.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-columns">
        ${chart.points
          .map(
            (point, index) => `
              <div class="indicators-columns__item indicators-hover-target"${renderIndicatorsTooltipAttr(`${point.label}: ${formatIndicatorsMetric(point.primary)}`)}>
                <span class="indicators-columns__value">${escapeHtml(formatIndicatorsMetric(point.primary))}</span>
                <div class="indicators-columns__track">
                  <span class="indicators-columns__bar indicators-columns__bar--${(index % 5) + 1}" style="height:${Math.max(((Number(point.primary) || 0) / maxValue) * 100, 10)}%"></span>
                </div>
                <span class="indicators-columns__label">${escapeHtml(point.label)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderIndicatorsDonutPanel(chart) {
  if (!chart?.items?.length) {
    return renderIndicatorsFallbackPanel(chart?.title || "التوزيع غير متاح", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  let currentOffset = 0;
  const gradient = chart.items
    .map((item, index) => {
      const color = `var(--indicators-chart-${(index % 5) + 1})`;
      const nextOffset = currentOffset + Number(item.share || 0);
      const segment = `${color} ${currentOffset}% ${nextOffset}%`;
      currentOffset = nextOffset;
      return segment;
    })
    .join(", ");

  return `
    <div class="indicators-panel indicators-panel--donut">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(chart.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(chart.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-donut">
        <div class="indicators-donut__chart" style="background:conic-gradient(${gradient});">
          <div class="indicators-donut__center">
            <strong>${escapeHtml(formatIndicatorsMetric(chart.total))}</strong>
          </div>
        </div>
        <div class="indicators-donut__legend">
          ${chart.items
            .map(
              (item, index) => `
                <div class="indicators-donut__legend-item indicators-hover-target"${renderIndicatorsTooltipAttr(`${item.label}: ${formatIndicatorsPercent(item.share)} | ${formatIndicatorsMetric(item.value)}`)}>
                  <span class="indicators-donut__legend-label">
                    <i style="background:var(--indicators-chart-${(index % 5) + 1})"></i>
                    ${escapeHtml(item.label)}
                  </span>
                  <strong>${escapeHtml(formatIndicatorsPercent(item.share))}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderIndicatorsComparisonPanel(chart) {
  if (!chart?.points?.length) {
    return renderIndicatorsFallbackPanel(chart?.title || "المقارنة غير متاحة", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  const maxValue = getChartScale(
    chart.points.flatMap((point) => [point.primary || 0, point.secondary || 0]),
  );

  return `
    <div class="indicators-panel indicators-panel--comparison">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(chart.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(chart.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-comparison">
        ${chart.points
          .map(
            (point) => `
              <div class="indicators-comparison__item indicators-hover-target"${renderIndicatorsTooltipAttr(`${point.label}: ${chart.primaryLabel || "القيمة"} ${formatIndicatorsMetric(point.primary)}${chart.secondaryLabel ? ` | ${chart.secondaryLabel} ${formatIndicatorsMetric(point.secondary)}` : ""}`)}>
                <div class="indicators-comparison__bars">
                  <span class="indicators-comparison__bar indicators-comparison__bar--primary" style="height:${Math.max(((Number(point.primary) || 0) / maxValue) * 100, 8)}%"></span>
                  ${
                    chart.secondaryLabel
                      ? `<span class="indicators-comparison__bar indicators-comparison__bar--secondary" style="height:${Math.max(((Number(point.secondary) || 0) / maxValue) * 100, 8)}%"></span>`
                      : ""
                  }
                </div>
                <strong>${escapeHtml(point.label)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderIndicatorsRadarPanel(chart) {
  if (!chart?.items?.length) {
    return renderIndicatorsFallbackPanel(chart?.title || "البصمة غير متاحة", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  const values = chart.items.map((item) => Number(item.share ?? item.value ?? 0));
  const maxValue = Math.max(...values, 1);
  const centerX = 110;
  const centerY = 95;
  const radius = 64;
  const points = chart.items
    .map((item, index) => {
      const angle = ((Math.PI * 2) / chart.items.length) * index - Math.PI / 2;
      const distance = (Number(item.share ?? item.value ?? 0) / maxValue) * radius;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return `
    <div class="indicators-panel indicators-panel--radar">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(chart.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(chart.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-radar">
        <svg viewBox="0 0 220 190">
          <polygon class="indicators-radar__grid" points="110,18 171,58 156,136 64,136 49,58"></polygon>
          <polygon class="indicators-radar__shape" points="${points}"></polygon>
        </svg>
        <div class="indicators-radar__labels">
          ${chart.items
            .map(
              (item) => `
                <span class="indicators-hover-target"${renderIndicatorsTooltipAttr(`${item.label}: ${formatIndicatorsPercent(item.share ?? item.value)}`)}>${escapeHtml(item.label)}</span>
              `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderIndicatorsRankingPanel(chart) {
  if (!chart?.items?.length) {
    return renderIndicatorsFallbackPanel(chart?.title || "الترتيب غير متاح", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  const maxValue = getChartScale(chart.items.map((item) => item.value));

  return `
    <div class="indicators-panel indicators-panel--ranking">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(chart.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(chart.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-ranking">
        ${chart.items
          .map(
            (item, index) => `
              <div class="indicators-ranking__row indicators-hover-target"${renderIndicatorsTooltipAttr(`${item.label}: ${formatIndicatorsMetric(item.value)} | ${formatIndicatorsPercent(item.share ?? 0)}`)}>
                <span class="indicators-ranking__label">${escapeHtml(item.label)}</span>
                <div class="indicators-ranking__track">
                  <span class="indicators-ranking__bar" style="width:${Math.max(((Number(item.value) || 0) / maxValue) * 100, 10)}%; background:var(--indicators-chart-${(index % 5) + 1});"></span>
                </div>
                <strong class="indicators-ranking__value">${escapeHtml(formatIndicatorsMetric(item.value))}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderIndicatorsFieldQualityPanel(chart) {
  if (!chart?.items?.length) {
    return renderIndicatorsFallbackPanel(chart?.title || "اكتمال الحقول", chart?.subtitle || "لا توجد بيانات كافية.");
  }

  return `
    <div class="indicators-panel indicators-panel--field-bars">
      <div class="indicators-panel__header">
        <div>
          <h4 class="indicators-panel__title">${escapeHtml(chart.title)}</h4>
          <p class="indicators-panel__subtitle">${escapeHtml(chart.subtitle || "")}</p>
        </div>
      </div>
      <div class="indicators-field-bars">
        ${chart.items
          .map(
            (item, index) => `
              <div class="indicators-field-bars__row indicators-hover-target"${renderIndicatorsTooltipAttr(`${item.label}: ${formatIndicatorsPercent(item.value)}`)}>
                <span class="indicators-field-bars__label">${escapeHtml(item.label)}</span>
                <div class="indicators-field-bars__track">
                  <span class="indicators-field-bars__bar" style="width:${Math.max(Number(item.value) || 0, 4)}%; background:var(--indicators-chart-${(index % 5) + 1});"></span>
                </div>
                <strong>${escapeHtml(formatIndicatorsPercent(item.value))}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderIndicatorsAssistantPanel(assistant) {
  if (!assistant) {
    return "";
  }

  return `
    <section class="indicators-assistant">
      <div class="indicators-assistant__hero">
        <span class="indicators-assistant__eyebrow">مساعد التحليل</span>
        <h3 class="indicators-assistant__headline">${escapeHtml(assistant.headline || "تم تجهيز قراءة داخلية للملف.")}</h3>
        <p class="indicators-assistant__summary">${escapeHtml(assistant.summary || "")}</p>
      </div>

      <div class="indicators-assistant__focus">
        ${(assistant.focus || [])
          .map(
            (item) => `
              <article class="indicators-assistant__focus-card">
                <span class="indicators-assistant__focus-label">${escapeHtml(item.label)}</span>
                <strong class="indicators-assistant__focus-value">${escapeHtml(item.value)}</strong>
                <p class="indicators-assistant__focus-detail">${escapeHtml(item.detail || "")}</p>
              </article>
            `,
          )
          .join("")}
      </div>

      <div class="indicators-assistant__grid">
        <div class="indicators-assistant__block">
          <div class="indicators-assistant__block-head">
            <h4>أبرز ما قرأه النظام</h4>
            <p>خلاصة تنفيذية مباشرة من نفس التحليل الحالي.</p>
          </div>
          <div class="indicators-assistant__items">
            ${(assistant.findings || [])
              .map(
                (item) => `
                  <article class="indicators-assistant__item indicators-assistant__item--${escapeHtml(item.tone || "cyan")}">
                    <strong>${escapeHtml(item.title)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>
                `,
              )
              .join("")}
          </div>
        </div>

        <div class="indicators-assistant__block">
          <div class="indicators-assistant__block-head">
            <h4>الإجراء المقترح</h4>
            <p>ما الذي يستحق المتابعة أولًا قبل الاعتماد النهائي.</p>
          </div>
          <div class="indicators-assistant__actions">
            ${(assistant.actions || [])
              .map(
                (item) => `
                  <div class="indicators-assistant__action">
                    <i></i>
                    <span>${escapeHtml(item)}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderIndicatorsTemplate() {
  const analysis = uiState.indicatorsAnalysis;
  const assistant = analysis?.assistant;
  const statusMeta = getIndicatorsAnalysisStatusMeta(analysis);
  const recommendation = getIndicatorsPrimaryRecommendation(analysis);
  const headerSubtitle = analysis
    ? assistant?.summary || statusMeta.description
    : "ارفع ملف Excel أو CSV للحصول على قراءة إدارية واضحة ثم التفاصيل الفنية عند الحاجة.";

  return renderPageLayout({
    viewClass: "indicators",
    headerClass: "page-exec-header--indicators",
    title: "تحليل المؤشرات",
    subtitle: headerSubtitle,
    actions: [
      `
        <label class="action-button action-button--primary indicators-upload-action" for="indicators-file-input">
          اختيار ملف للتحليل
        </label>
      `,
      analysis
        ? `
          <button class="action-button action-button--ghost" type="button" data-action="clear-indicators-analysis">
            مسح النتيجة
          </button>
        `
        : "",
    ].filter(Boolean),
    content: `
      ${renderIndicatorsUploadShell()}
      ${
        analysis
          ? `
            <section class="card section-block section-block--indicators-results">
              <div class="section-heading section-heading--start">
                <div>
                  <h3 class="section-title">نتيجة التحليل</h3>
                  <p class="section-subtitle">تم ترتيب النتيجة لتناسب القراءة الإدارية أولًا ثم المراجعة الفنية لاحقًا.</p>
                </div>
              </div>

              <div class="indicators-admin-shell">
                <section class="indicators-admin-hero indicators-admin-hero--${statusMeta.tone}">
                  <div class="indicators-admin-hero__copy">
                    <span class="indicators-admin-hero__eyebrow">${escapeHtml(analysis?.meta?.filename || "ملف مرفوع")}</span>
                    <h3 class="indicators-admin-hero__title">${escapeHtml(assistant?.headline || "تم تجهيز نتيجة التحليل.")}</h3>
                    <p class="indicators-admin-hero__text">${escapeHtml(statusMeta.description)}</p>
                  </div>
                  <div class="indicators-admin-hero__status">
                    <span class="indicators-status-pill indicators-status-pill--${statusMeta.tone}">${escapeHtml(statusMeta.label)}</span>
                  </div>
                </section>

                <div class="indicators-admin-grid">
                  ${renderIndicatorsExecutiveCards(analysis)}
                </div>

                <div class="indicators-admin-briefs">
                  <article class="indicators-admin-brief">
                    <span class="indicators-admin-brief__label">الملخص التنفيذي</span>
                    <p class="indicators-admin-brief__text">${escapeHtml(assistant?.summary || "لم يصل ملخص تنفيذي من خدمة التحليل.")}</p>
                  </article>
                  <article class="indicators-admin-brief indicators-admin-brief--action">
                    <span class="indicators-admin-brief__label">التوصية أو الإجراء</span>
                    <p class="indicators-admin-brief__text">${escapeHtml(recommendation)}</p>
                  </article>
                </div>

                ${renderIndicatorsTechnicalDetails(analysis)}
                ${renderIndicatorsDetailedAnalysis(analysis)}
              </div>
            </section>
          `
          : renderIndicatorsEmptyState()
      }
    `,
  });
}

function getAlertsExecutiveSummary() {
  const alertsData = getAlertsData();
  const within7 = alertsData.within7.length;
  const missing = alertsData.missingData.length;
  const expired = alertsData.expired.length;
  const total = within7 + alertsData.within30.length + expired + missing;

  return `يوجد ${formatNumber(total)} حالات ضمن التنبيهات الحالية، منها ${formatNumber(within7)} خلال 7 أيام و${formatNumber(missing)} ملفات ناقصة و${formatNumber(expired)} حالات منتهية.`;
}

function getReportsExecutiveSummary() {
  const filteredTrainees = filterReportTrainees();
  const nearEnding = filteredTrainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30).length;
  const missing = filteredTrainees.filter((trainee) => trainee.missingData).length;

  return `يعرض التقرير ${formatNumber(filteredTrainees.length)} سجلًا بعد التصفية الحالية، بينها ${formatNumber(nearEnding)} حالات قريبة الانتهاء و${formatNumber(missing)} ملفات ناقصة.`;
}

function getSettingsExecutiveSummary() {
  const isDarkTheme = document.body.dataset.theme === "dark";
  const isSidebarCollapsed = document.body.dataset.sidebar === "collapsed";

  return `الإعدادات الحالية تعتمد ${isDarkTheme ? "الوضع الليلي" : "الوضع النهاري"} مع ${isSidebarCollapsed ? "شريط جانبي مصغر" : "شريط جانبي موسع"}، ويمكن تعديل المظهر والتفضيلات التشغيلية من هنا.`;
}

function renderAlertsTemplate() {
  return renderPageLayout({
    viewClass: "alerts",
    title: "التنبيهات",
    subtitle: getAlertsExecutiveSummary(),
    content: `
      <section id="alerts-grid" class="alerts-grid"></section>
    `,
  });
}

function renderReportsTemplate() {
  return renderPageLayout({
    viewClass: "reports",
    title: "التقارير",
    subtitle: getReportsExecutiveSummary(),
    actions: [
      `
        <button class="action-button action-button--ghost" type="button" data-action="export-report-csv">
          تصدير CSV
        </button>
      `,
      `
        <button class="action-button action-button--primary" type="button" data-action="print-report">
          نسخة للطباعة
        </button>
      `,
    ],
    content: `
      <section class="card page-section-card reports-filters-card">
        <div class="section-heading">
          <div>
            <h3 class="section-title">فلاتر التقرير</h3>
            <p class="section-subtitle">وحّد الفترة والإدارة والحالة قبل مراجعة الملخص والجداول.</p>
          </div>
        </div>

        <div class="field-grid field-grid--reports">
          <label class="field">
            <span class="field__label">الفترة</span>
            <select id="report-filter-period" class="field__select">
              ${renderReportPeriodOptions(uiState.reportFilters.period)}
            </select>
          </label>
          <label class="field">
            <span class="field__label">الإدارة</span>
            <select id="report-filter-department" class="field__select">
              ${renderDepartmentOptions(uiState.reportFilters.department)}
            </select>
          </label>
          <label class="field">
            <span class="field__label">الحالة</span>
            <select id="report-filter-status" class="field__select">
              ${renderStatusOptions(uiState.reportFilters.status)}
            </select>
          </label>
        </div>
      </section>

      <section class="summary-grid summary-grid--reports" id="reports-summary"></section>

      <section class="reports-layout">
        <section class="card section-block section-block--chart">
          <div class="section-heading">
            <h3 class="section-title">التوزيع حسب الإدارة</h3>
          </div>
          <div id="reports-chart" class="chart chart--bars"></div>
        </section>

        <section class="card section-block section-block--chart">
          <div class="section-heading">
            <h3 class="section-title">ملخص الإدارات</h3>
          </div>
          <div class="table-wrapper">
            <table class="data-table data-table--compact">
              <thead>
                <tr>
                  <th>الإدارة</th>
                  <th>عدد المتدربين</th>
                  <th>قريبة الانتهاء</th>
                </tr>
              </thead>
              <tbody id="reports-table-body"></tbody>
            </table>
          </div>
        </section>
      </section>
    `,
  });
}

function getTraineesOverviewCards(trainees = filterTraineesDirectory()) {
  return [
    {
      label: "إجمالي المتدربين",
      value: trainees.length,
      meta: "السجلات المطابقة للفلاتر الحالية",
      tone: "accent",
    },
    {
      label: "النشطون",
      value: trainees.filter((trainee) => trainee.status === "نشط").length,
      meta: "لا يحتاجون إجراءً مباشرًا الآن",
      tone: "success",
    },
    {
      label: "قريبو الانتهاء",
      value: trainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30).length,
      meta: "ضمن نافذة 30 يوم",
      tone: "info",
    },
    {
      label: "المنتهية فترتهم",
      value: trainees.filter((trainee) => trainee.daysLeft < 0).length,
      meta: "تحتاج إغلاقًا أو تحديثًا",
      tone: "warning",
    },
  ];
}

function hasActiveTraineesFilters() {
  return (
    uiState.traineesFilters.search.trim() ||
    uiState.traineesFilters.department !== "all" ||
    uiState.traineesFilters.status !== "all" ||
    uiState.traineesFilters.remaining !== "all"
  );
}

function getTraineesExecutiveSummary() {
  const trainees = filterTraineesDirectory();
  const activeCount = trainees.filter((trainee) => trainee.status === "نشط").length;
  const nearCount = trainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30).length;
  const expiredCount = trainees.filter((trainee) => trainee.daysLeft < 0).length;

  return `يعرض السجل ${formatNumber(trainees.length)} متدربًا، بينهم ${formatNumber(activeCount)} نشطون و${formatNumber(nearCount)} قريبو انتهاء و${formatNumber(expiredCount)} حالات منتهية.`;
}

function renderTraineesKpiRow() {
  return `<section id="trainees-kpi-row" class="trainees-kpi-row"></section>`;
}

function renderTraineesKpiCards() {
  const container = document.getElementById("trainees-kpi-row");

  if (!container) {
    return;
  }

  container.innerHTML = getTraineesOverviewCards()
    .map(
      (card) => `
        <article class="summary-card summary-card--${card.tone}">
          <span class="summary-card__accent"></span>
          <p class="summary-card__label">${card.label}</p>
          <h4 class="summary-card__value" data-count-target="${card.value}">${formatNumber(card.value)}</h4>
          <p class="summary-card__meta">${card.meta}</p>
        </article>
      `,
    )
    .join("");
}

function renderTraineesTemplate() {
  return renderPageLayout({
    viewClass: "trainees",
    headerClass: "page-exec-header--compact page-exec-header--trainees",
    title: "إدارة المتدربين",
    subtitle: getTraineesExecutiveSummary(),
    toolbarMode: "custom",
    toolbarContent: `
      <section class="card page-section-card page-section-card--compact trainees-toolbar-card">
        <div class="field-grid field-grid--directory trainees-toolbar-grid">
          <label class="field field--toolbar">
            <span class="field__label">البحث</span>
            <input
              id="trainees-local-search"
              class="field__control field__control--search"
              type="search"
              placeholder="ابحث باسم المتدرب أو الإدارة"
              value="${escapeHtml(uiState.traineesFilters.search)}"
            />
          </label>
          <label class="field field--toolbar">
            <span class="field__label">الإدارة</span>
            <select id="trainees-filter-department" class="field__select">
              ${renderDepartmentOptions(uiState.traineesFilters.department)}
            </select>
          </label>
          <label class="field field--toolbar">
            <span class="field__label">الحالة</span>
            <select id="trainees-filter-status" class="field__select">
              ${renderStatusOptions(uiState.traineesFilters.status)}
            </select>
          </label>
          <label class="field field--toolbar">
            <span class="field__label">المدة المتبقية</span>
            <select id="trainees-filter-remaining" class="field__select">
              ${renderRemainingOptions(uiState.traineesFilters.remaining)}
            </select>
          </label>
        </div>
      </section>
    `,
    actions: hasActiveTraineesFilters()
      ? [
          `
            <button class="action-button action-button--ghost" type="button" data-action="reset-trainees-filters">
              مسح الفلاتر
            </button>
          `,
        ]
      : [],
    content: `
      ${renderTraineesKpiRow()}

      <section class="card page-section-card trainees-table-card">
        <div class="section-heading trainees-table-card__heading">
          <h3 class="section-title">سجل المتدربين</h3>
          <span id="directory-count" class="section-note-pill">--</span>
        </div>
        <div class="table-wrapper">
          <table class="data-table data-table--directory">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الإدارة</th>
                <th>تاريخ البداية</th>
                <th>تاريخ النهاية</th>
                <th>الأيام المتبقية</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody id="directory-table-body"></tbody>
          </table>
        </div>
      </section>
    `,
  });
}

function renderPageLayout({
  viewClass,
  title,
  subtitle = "",
  actions = [],
  content = "",
  headerClass = "",
  toolbarMode = "topbar",
  toolbarContent = "",
}) {
  const pageHeaderClass = ["section-block", "page-exec-header", headerClass].filter(Boolean).join(" ");
  const toolbarAnchorClass = [
    "page-toolbar",
    viewClass === "dashboard" ? "dashboard-exec-toolbar" : "",
    toolbarMode === "custom" ? "page-toolbar--hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <section class="page-view page-view--unified page-view--${viewClass}">
      <section class="${pageHeaderClass}">
        <div class="page-exec-header__main">
          <h3 class="page-exec-header__title">${escapeHtml(title)}</h3>
          ${subtitle ? `<p class="page-exec-header__text">${escapeHtml(subtitle)}</p>` : ""}
          ${actions.length ? `<div class="page-exec-header__actions">${actions.join("")}</div>` : ""}
        </div>
      </section>

      <div id="page-toolbar-anchor" class="${toolbarAnchorClass}"${toolbarMode === "custom" ? " hidden" : ""}></div>
      ${toolbarMode === "custom" && toolbarContent ? toolbarContent : ""}

      ${content}
    </section>
  `;
}

function renderDashboardTemplate() {
  const overview = getDashboardExecutiveOverview();

  return renderPageLayout({
    viewClass: "dashboard",
    headerClass: "dashboard-exec-hero executive-card",
    title: overview.headline,
    subtitle: overview.summary,
    actions: [
      `
        <button class="action-button action-button--primary" type="button" data-action="open-dashboard-view" data-view="alerts">
          عرض التنبيهات
        </button>
      `,
      `
        <button class="action-button action-button--ghost" type="button" data-action="open-dashboard-view" data-view="reports">
          الانتقال إلى التقارير
        </button>
      `,
    ],
    content: `
      <section id="dashboard-exec-metrics" class="dashboard-exec-metrics"></section>

      <section class="dashboard-exec-grid dashboard-exec-grid--primary">
        <section class="section-block dashboard-exec-panel">
          <div class="section-heading">
            <div>
              <h3 class="section-title">قرارات اليوم</h3>
              <p class="section-subtitle">أهم الملفات التي تستحق النظر أولًا في الاجتماع أو المتابعة السريعة.</p>
            </div>
          </div>
          <div id="dashboard-exec-actions" class="dashboard-exec-actions"></div>
        </section>

        <section class="section-block dashboard-exec-panel dashboard-exec-panel--status">
          <div class="section-heading">
            <div>
              <h3 class="section-title">الصورة العامة</h3>
              <p class="section-subtitle">هل الوضع مستقر أم أن هناك ضغطًا يحتاج متابعة إدارية؟</p>
            </div>
          </div>
          <div id="dashboard-status-ring" class="status-ring-card status-ring-card--executive"></div>
        </section>
      </section>

      <section class="dashboard-exec-grid dashboard-exec-grid--secondary">
        <section class="section-block dashboard-exec-panel">
          <div class="section-heading">
            <div>
              <h3 class="section-title">أكثر الإدارات احتياجًا للمتابعة</h3>
              <p class="section-subtitle">ترتيب سريع للإدارات التي يتركز فيها العبء الحالي.</p>
            </div>
          </div>
          <div id="dashboard-department-focus" class="dashboard-department-focus"></div>
        </section>

        <section class="section-block dashboard-exec-panel">
          <div class="section-heading">
            <div>
              <h3 class="section-title">الانتقال إلى التفاصيل</h3>
              <p class="section-subtitle">روابط مختصرة للانتقال السريع إلى الصفحات التفصيلية فقط عند الحاجة.</p>
            </div>
          </div>
          <div id="dashboard-exec-routes" class="dashboard-exec-routes"></div>
        </section>
      </section>
    `,
  });
}

function getCurrentViewTemplate() {
  switch (uiState.currentView) {
    case "indicators":
      return renderIndicatorsTemplate();
    case "trainees":
      return renderTraineesTemplate();
    case "trainee-details": {
      const trainee = getSelectedTrainee();

      return `
        <section class="page-view">
          <section class="section-block">
            <div class="section-heading section-heading--start">
              <div>
                <h3 class="section-title">ملف المتدرب</h3>
                <p class="section-subtitle">عرض إداري مختصر للحالة الحالية والبيانات الأساسية.</p>
              </div>
              <button class="action-button action-button--ghost" type="button" data-action="back-to-trainees">
                العودة إلى المتدربين
              </button>
            </div>

            <div class="detail-hero">
              <div class="detail-hero__main">
                <p class="detail-hero__eyebrow">رقم السجل ${formatNumber(trainee.id)}</p>
                <h2 class="detail-hero__name">${trainee.name}</h2>
              </div>
              <div class="detail-hero__meta">
                ${renderStatusBadge(trainee.status, trainee.statusTone)}
                <span class="detail-hero__remaining">${getRemainingDaysLabel(trainee.daysLeft)}</span>
              </div>
            </div>
          </section>

          <section class="detail-sections-grid">
            <section id="trainee-basic-info" class="section-block">
              <div class="section-heading">
                <h3 class="section-title">المعلومات الأساسية</h3>
              </div>
              <div class="detail-grid detail-grid--basic">
                ${renderDetailCard("الإدارة", trainee.department)}
                ${renderDetailCard("المشرف", trainee.supervisor)}
                ${renderDetailCard("الجهة", trainee.agency)}
                ${renderDetailCard("الحالة", renderStatusBadge(trainee.status, trainee.statusTone), true)}
              </div>
            </section>

            <section class="section-block">
              <div class="section-heading">
                <h3 class="section-title">فترة التدريب</h3>
              </div>
              <div class="detail-grid detail-grid--period">
                ${renderDetailCard("تاريخ البداية", formatDate(trainee.startDate))}
                ${renderDetailCard("تاريخ النهاية", formatDate(trainee.endDate))}
                ${renderDetailCard("الأيام المتبقية", getRemainingDaysLabel(trainee.daysLeft))}
              </div>
            </section>
          </section>

          <section class="section-block">
            <div class="section-heading">
              <h3 class="section-title">الملاحظات</h3>
            </div>
            <div class="notes-card">
              <p class="notes-card__text">${escapeHtml(trainee.notes)}</p>
            </div>
          </section>

          <section class="section-block">
            <div class="section-heading">
              <h3 class="section-title">الإجراءات</h3>
            </div>
            <div class="detail-actions">
              <button class="action-button action-button--ghost" type="button" data-action="focus-basic-info">
                عرض التفاصيل
              </button>
              <button class="action-button action-button--primary" type="button" data-action="update-trainee-status">
                تحديث الحالة
              </button>
              <button class="action-button action-button--ghost" type="button" data-action="add-trainee-note">
                إضافة ملاحظة
              </button>
            </div>
          </section>
        </section>
      `;
    }
    case "alerts":
      return renderAlertsTemplate();
    case "reports":
      return renderReportsTemplate();
    case "settings":
      return renderSettingsView();
    default:
      return renderDashboardTemplate();
  }
}

function renderSettingsView() {
  const isDarkTheme = document.body.dataset.theme === "dark";
  const isSidebarCollapsed = document.body.dataset.sidebar === "collapsed";

  return renderPageLayout({
    viewClass: "settings",
    title: "الإعدادات",
    subtitle: getSettingsExecutiveSummary(),
    content: `
      <section class="card page-section-card settings-section">
        <div class="section-heading">
          <div>
            <h3 class="section-title">إعدادات المظهر</h3>
            <p class="section-subtitle">تحكم مباشر في طريقة عرض النظام دون تغيير الهوية البصرية المعتمدة.</p>
          </div>
        </div>

        <div class="settings-list">
          <div class="card setting-row">
            <div class="setting-row__meta">
              <h4 class="setting-row__title">الوضع الليلي / النهاري</h4>
              <p class="setting-row__text">الحالة الحالية: ${isDarkTheme ? "الوضع الليلي" : "الوضع النهاري"}</p>
            </div>
            <button class="action-button action-button--primary" type="button" data-action="toggle-theme-setting">
              ${isDarkTheme ? "العودة للوضع النهاري" : "تفعيل الوضع الليلي"}
            </button>
          </div>

          <div class="card setting-row">
            <div class="setting-row__meta">
              <h4 class="setting-row__title">تصغير الشريط الجانبي</h4>
              <p class="setting-row__text">الحالة الحالية: ${isSidebarCollapsed ? "الشريط الجانبي مصغر" : "الشريط الجانبي موسع"}</p>
            </div>
            <button class="action-button action-button--ghost" type="button" data-action="toggle-sidebar-setting">
              ${isSidebarCollapsed ? "توسيع الشريط الجانبي" : "تصغير الشريط الجانبي"}
            </button>
          </div>
        </div>
      </section>

      <section class="card page-section-card settings-section">
        <div class="section-heading">
          <div>
            <h3 class="section-title">إعدادات عامة</h3>
            <p class="section-subtitle">خيارات تشغيلية بسيطة قابلة للتوسعة لاحقًا حسب احتياج الجهة.</p>
          </div>
        </div>

        <div class="settings-list">
          ${renderToggleSettingRow(
            "عرض التاريخ الهجري",
            "يبدّل طريقة عرض التواريخ بين الميلادي والهجري على مستوى النظام.",
            "useHijriDates",
            uiState.settings.useHijriDates,
          )}
          ${renderToggleSettingRow(
            "التنبيهات اليومية",
            "يحافظ على تنبيهات المتابعة اليومية مفعلة كإعداد افتراضي داخل النظام.",
            "dailyAlerts",
            uiState.settings.dailyAlerts,
          )}
          ${renderToggleSettingRow(
            "المؤشرات المختصرة",
            "يتيح وضعًا تجريبيًا لعرض المؤشرات بشكل أكثر اختصارًا عند الحاجة.",
            "compactIndicators",
            uiState.settings.compactIndicators,
          )}
        </div>
      </section>
    `,
  });
}

function renderToggleSettingRow(title, description, key, isActive) {
  return `
    <div class="card setting-row">
      <div class="setting-row__meta">
        <h4 class="setting-row__title">${title}</h4>
        <p class="setting-row__text">${description}</p>
      </div>
      <button
        class="toggle-switch${isActive ? " toggle-switch--active" : ""}"
        type="button"
        data-action="toggle-setting"
        data-setting-key="${key}"
        aria-pressed="${String(isActive)}"
      >
        <span class="toggle-switch__label">${isActive ? "مفعل" : "غير مفعل"}</span>
      </button>
    </div>
  `;
}

function renderDetailCard(label, value, allowHtml = false) {
  return `
    <article class="detail-card">
      <p class="detail-card__label">${label}</p>
      <div class="detail-card__value">${allowHtml ? value : escapeHtml(value)}</div>
    </article>
  `;
}

function renderDepartmentOptions(selectedValue) {
  const options = [
    { value: "all", label: "جميع الإدارات" },
    ...getUniqueDepartments().map((department) => ({ value: department, label: department })),
  ];

  return options
    .map(
      (option) => `
        <option value="${option.value}"${selectedValue === option.value ? " selected" : ""}>
          ${option.label}
        </option>
      `,
    )
    .join("");
}

function renderStatusOptions(selectedValue) {
  const options = [
    { value: "all", label: "جميع الحالات" },
    { value: "نشط", label: "نشط" },
    { value: "قريب انتهاء", label: "قريب انتهاء" },
    { value: "عاجل", label: "عاجل" },
    { value: "بيانات ناقصة", label: "بيانات ناقصة" },
    { value: "منتهي", label: "منتهي" },
  ];

  return options
    .map(
      (option) => `
        <option value="${option.value}"${selectedValue === option.value ? " selected" : ""}>
          ${option.label}
        </option>
      `,
    )
    .join("");
}

function renderRemainingOptions(selectedValue) {
  const options = [
    { value: "all", label: "جميع الفترات" },
    { value: "lt7", label: "أقل من 7 أيام" },
    { value: "lt30", label: "أقل من 30 يوم" },
    { value: "gt30", label: "أكثر من 30 يوم" },
    { value: "expired", label: "منتهية" },
  ];

  return options
    .map(
      (option) => `
        <option value="${option.value}"${selectedValue === option.value ? " selected" : ""}>
          ${option.label}
        </option>
      `,
    )
    .join("");
}

function renderReportPeriodOptions(selectedValue) {
  const options = [
    { value: "all", label: "جميع الفترات" },
    { value: "month", label: "نهاية هذا الشهر" },
    { value: "30", label: "خلال 30 يوم" },
    { value: "90", label: "خلال 90 يوم" },
    { value: "expired", label: "الحالات المنتهية" },
  ];

  return options
    .map(
      (option) => `
        <option value="${option.value}"${selectedValue === option.value ? " selected" : ""}>
          ${option.label}
        </option>
      `,
    )
    .join("");
}

function updateTopbarForCurrentView() {
  const viewData = viewMeta[uiState.currentView];
  const headingCopy = document.querySelector(".topbar__heading-copy");
  const searchInput = document.getElementById("search-input");
  const usesUnifiedLayout = usesUnifiedPageLayout(uiState.currentView);

  if (headingCopy) {
    headingCopy.innerHTML =
      usesUnifiedLayout
        ? `<p class="topbar__eyebrow">نظام إدارة ومتابعة المتدربين</p>`
        : `
          <p class="topbar__eyebrow">نظام إدارة ومتابعة المتدربين</p>
          <h2 id="topbar-title" class="topbar__title">${escapeHtml(viewData.title)}</h2>
          <p id="topbar-subtitle" class="topbar__subtitle">${escapeHtml(viewData.subtitle)}</p>
        `;
  }

  searchInput.placeholder = viewData.topbarSearchPlaceholder;
  searchInput.value = getTopbarSearchValue();
}

function usesUnifiedPageLayout(view) {
  return ["dashboard", "indicators", "trainees", "alerts", "reports", "settings"].includes(view);
}

function restoreTopbarMetaToHeader() {
  const topbar = document.querySelector(".topbar");
  const heading = topbar?.querySelector(".topbar__heading");
  const meta = document.querySelector(".topbar__meta");

  if (!topbar || !heading || !meta || meta.parentElement === topbar) {
    return;
  }

  heading.insertAdjacentElement("afterend", meta);
}

function syncUnifiedToolbarPlacement() {
  const meta = document.querySelector(".topbar__meta");

  if (!meta) {
    return;
  }

  if (!usesUnifiedPageLayout(uiState.currentView)) {
    restoreTopbarMetaToHeader();
    return;
  }

  const anchor = document.getElementById("page-toolbar-anchor");

  if (!anchor) {
    restoreTopbarMetaToHeader();
    return;
  }

  if (meta.parentElement !== anchor) {
    anchor.appendChild(meta);
  }
}

function getTopbarSearchValue() {
  switch (uiState.currentView) {
    case "dashboard":
    case "indicators":
      return uiState.dashboardSearch;
    case "trainees":
      return uiState.traineesFilters.search;
    case "alerts":
      return uiState.alertSearch;
    case "reports":
      return uiState.reportSearch;
    default:
      return "";
  }
}

function renderCurrentDate() {
  document.getElementById("current-date").textContent = formatCurrentDate();
}

function renderSummaryCards(cards = getDashboardSummaryCards()) {
  const container = document.getElementById("summary-cards");

  container.innerHTML = cards
    .map(
      (card, index) => `
        <article
          class="summary-card summary-card--${card.tone || "accent"} card--interactive${uiState.activeSummaryCard === index ? " card--selected" : ""}"
          role="button"
          tabindex="0"
          aria-pressed="${String(uiState.activeSummaryCard === index)}"
          data-card-group="summary"
          data-card-index="${index}"
        >
          <span class="summary-card__accent"></span>
          <p class="summary-card__label">${card.label}</p>
          <h4 class="summary-card__value" data-count-target="${card.value}">${formatNumber(card.value)}</h4>
          <p class="summary-card__meta">${card.meta}</p>
        </article>
      `,
    )
    .join("");
}

function renderActionCards() {
  const container = document.getElementById("action-cards");

  container.innerHTML = getDashboardActionCards()
    .map(
      (card, index) => `
        <article
          class="action-card card--interactive${uiState.activeActionCard === index ? " card--selected" : ""}"
          role="button"
          tabindex="0"
          aria-pressed="${String(uiState.activeActionCard === index)}"
          data-card-group="action"
          data-card-index="${index}"
        >
          <div class="action-card__header">
            <p class="action-card__label">${card.label}</p>
            <span class="pill ${card.tone.className || ""}">
              ${formatNumber(card.count)}
            </span>
          </div>
          <h4 class="action-card__count">${formatNumber(card.count)}</h4>
          <p class="action-card__text">${card.text}</p>
        </article>
      `,
    )
    .join("");
}

function renderDashboardPrioritySection() {
  const tabsContainer = document.getElementById("priority-tabs");
  const listContainer = document.getElementById("priority-list");
  const tabs = [
    { id: "all", label: "الكل" },
    { id: "urgent", label: "عاجل" },
    { id: "near", label: "قريب" },
    { id: "expired", label: "منتهي" },
    { id: "missing", label: "بيانات ناقصة" },
  ];
  const priorityItems = getDashboardPriorityItems();

  tabsContainer.innerHTML = tabs
    .map(
      (tab) => `
        <button
          class="tab-button${uiState.dashboardPriorityTab === tab.id ? " tab-button--active" : ""}"
          type="button"
          role="tab"
          aria-selected="${String(uiState.dashboardPriorityTab === tab.id)}"
          data-action="set-priority-tab"
          data-priority-tab="${tab.id}"
        >
          ${tab.label}
        </button>
      `,
    )
    .join("");

  if (!priorityItems.length) {
    listContainer.innerHTML = `<div class="empty-state">لا توجد حالات ضمن هذا التصنيف حاليًا.</div>`;
    return;
  }

  listContainer.innerHTML = priorityItems
    .map(
      (trainee) => `
        <button
          class="priority-item priority-item--notification"
          type="button"
          data-action="open-alert-focus"
          data-alert-group="${getAlertGroupForTrainee(trainee)}"
          data-trainee-id="${trainee.id}"
          style="--priority-tone:${trainee.statusTone.color}; --priority-surface:${trainee.statusTone.background};"
        >
          <div class="priority-item__main">
            <span class="priority-item__badge-wrap">
              <span class="priority-item__dot" style="background:${trainee.statusTone.color}"></span>
              <strong class="priority-item__name">${trainee.name}</strong>
            </span>
            <span class="priority-item__meta">${trainee.department} · تحتاج متابعة الآن</span>
          </div>
          <div class="priority-item__status">
            ${renderStatusBadge(trainee.status, trainee.statusTone)}
            <span class="priority-item__days">${getRemainingDaysLabel(trainee.daysLeft)}</span>
          </div>
          <span class="priority-item__action">
            <span class="priority-item__hint">عرض التنبيه</span>
            <span class="priority-item__arrow" aria-hidden="true">‹</span>
          </span>
        </button>
      `,
    )
    .join("");
}

function getTraineeTooltip(items, emptyLabel) {
  if (!items.length) {
    return emptyLabel;
  }

  const previewNames = items
    .slice(0, 3)
    .map((trainee) => trainee.name)
    .join("، ");
  const suffix = items.length > 3 ? ` + ${formatNumber(items.length - 3)}` : "";

  return `${previewNames}${suffix}`;
}

function renderHeatmap() {
  const container = document.getElementById("dashboard-heatmap");
  const heatmapData = getHeatmapData();

  if (!heatmapData.rows.length) {
    container.innerHTML = `<div class="empty-state">لا توجد بيانات مطابقة ضمن نطاق البحث الحالي.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="heatmap-table">
      <div class="heatmap-table__row heatmap-table__row--header">
        <span class="heatmap-table__label heatmap-table__label--header">الإدارة</span>
        ${heatmapData.statuses
          .map(
            (status) => `
              <span class="heatmap-table__heading">${status}</span>
            `,
          )
          .join("")}
      </div>
      ${heatmapData.rows
        .map((row) => {
          const totalCount = row.cells.reduce((sum, cell) => sum + cell.count, 0);

          return `
            <div class="heatmap-table__row">
              <div class="heatmap-table__label">
                <strong>${row.department}</strong>
                <span>${formatNumber(totalCount)} متدرب</span>
              </div>
              ${row.cells
                .map((cell) => {
                  const tone = getHeatmapCellTone(cell.status, cell.count);
                  const sortedItems = [...cell.items].sort((left, right) => left.daysLeft - right.daysLeft);
                  const previewTrainee = sortedItems[0];
                  const tooltip = `${row.department} - ${cell.status}: ${formatNumber(cell.count)} متدرب. ${getTraineeTooltip(sortedItems, "لا توجد حالات ضمن هذه الخانة.")}`;

                  return `
                    <button
                      class="heatmap-cell${previewTrainee ? " heatmap-cell--interactive" : " heatmap-cell--empty"}"
                      type="button"
                      ${previewTrainee ? `data-action="open-trainee" data-trainee-id="${previewTrainee.id}"` : "disabled"}
                      style="background:${tone.background}; color:${tone.color}"
                      title="${escapeHtml(tooltip)}"
                    >
                      <span class="heatmap-cell__count">${formatNumber(cell.count)}</span>
                      <span class="heatmap-cell__meta">${cell.status}</span>
                    </button>
                  `;
                })
                .join("")}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderForecastChart() {
  const container = document.getElementById("dashboard-forecast");
  const items = getForecastData();
  const maxValue = Math.max(...items.map((item) => item.count), 1);

  container.innerHTML = items
    .map((item) => {
      const previewTrainee = item.items[0];
      const tooltip = `${item.label}: ${formatNumber(item.count)} حالة. ${getTraineeTooltip(item.items, "لا توجد حالات متوقعة في هذا الأسبوع.")}`;

      return `
        <button
          class="forecast-item${previewTrainee ? " forecast-item--interactive" : ""}"
          type="button"
          ${previewTrainee ? `data-action="open-trainee" data-trainee-id="${previewTrainee.id}"` : "disabled"}
          title="${escapeHtml(tooltip)}"
        >
          <span class="forecast-item__value">${formatNumber(item.count)}</span>
          <div class="forecast-item__track">
            <span
              class="forecast-item__bar"
              style="--forecast-bar-height:${Math.max((item.count / maxValue) * 100, item.count ? 18 : 8)}%; height:${Math.max((item.count / maxValue) * 100, item.count ? 18 : 8)}%"
            ></span>
          </div>
          <span class="forecast-item__label">${item.label}</span>
          <span class="forecast-item__range">${item.min} - ${item.max} يوم</span>
        </button>
      `;
    })
    .join("");
}

function renderDashboardFlowChart() {
  const container = document.getElementById("dashboard-flow-chart");

  if (!container) {
    return;
  }

  const items = getDashboardFlowData();

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">لا توجد بيانات كافية لعرض التدفق ضمن النطاق الحالي.</div>`;
    return;
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const chartHeight = 170;
  const chartWidth = 520;
  const step = items.length > 1 ? chartWidth / (items.length - 1) : chartWidth;
  const points = items
    .map((item, index) => {
      const x = index * step;
      const y = chartHeight - (item.value / maxValue) * (chartHeight - 24) - 12;
      return `${x},${y}`;
    })
    .join(" ");

  container.innerHTML = `
      <div class="flow-chart__canvas">
        <svg class="flow-chart__svg" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="flow-line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="var(--chart-gradient-start)"></stop>
            <stop offset="100%" stop-color="var(--chart-gradient-end)"></stop>
          </linearGradient>
        </defs>
        <polyline class="flow-chart__line" points="${points}"></polyline>
      </svg>
      <div class="flow-chart__points">
        ${items
          .map((item, index) => {
            const top = chartHeight - (item.value / maxValue) * (chartHeight - 24) - 12;
            const topPercent = (top / chartHeight) * 100;
            const leftPercent = items.length > 1 ? (index / (items.length - 1)) * 100 : 50;
            const previewTrainee = item.items[0];
            const tooltip = `${item.label}: ${formatNumber(item.value)} متدربين. ${getTraineeTooltip(item.items, "لا توجد حالات ضمن هذا الشهر.")}`;

            return `
              <button
                class="flow-chart__point${previewTrainee ? " flow-chart__point--interactive" : ""}"
                type="button"
                ${previewTrainee ? `data-action="open-trainee" data-trainee-id="${previewTrainee.id}"` : "disabled"}
                style="top:${topPercent}%; left:${leftPercent}%;"
                title="${escapeHtml(tooltip)}"
              >
                <span class="flow-chart__point-dot"></span>
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
    <div class="flow-chart__labels">
      ${items
        .map(
          (item) => `
            <div class="flow-chart__label">
              <strong>${item.label}</strong>
              <span>${formatNumber(item.value)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDashboardStatusRing() {
  const container = document.getElementById("dashboard-status-ring");

  if (!container) {
    return;
  }

  const data = getDashboardStatusRingData();

  if (!data.total) {
    container.innerHTML = `<div class="empty-state">لا توجد بيانات كافية لعرض الحالة العامة ضمن هذا النطاق.</div>`;
    return;
  }

  const total = Math.max(data.total, 1);
  let start = 0;
  const gradient = data.segments
    .map((segment) => {
      const portion = (segment.count / total) * 100;
      const end = start + portion;
      const part = `${segment.color} ${start}% ${end}%`;
      start = end;
      return part;
    })
    .join(", ");

  container.innerHTML = `
    <div class="status-ring-card__visual">
      <div class="status-ring" style="background:conic-gradient(${gradient || "var(--tone-neutral) 0 100%"})">
        <div class="status-ring__center">
          <strong>${formatNumber(data.activeRatio)}%</strong>
          <span>استقرار</span>
        </div>
      </div>
    </div>
    <div class="status-ring-card__legend">
      ${data.segments
        .map(
          (segment) => `
            <div class="status-ring-card__legend-row">
              <span class="status-ring-card__legend-label">
                <span class="status-ring-card__legend-dot" style="background:${segment.color}"></span>
                ${segment.label}
              </span>
              <strong>${formatNumber(segment.count)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSupervisorLoadChart() {
  const container = document.getElementById("dashboard-supervisor-load");
  const items = getSupervisorLoadData();
  const maxTotal = Math.max(...items.map((item) => item.total), 1);

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">لا توجد بيانات متاحة لهذه التصفية.</div>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const totalWidth = (item.total / maxTotal) * 100;
      const criticalWidth = item.total ? (item.criticalCount / item.total) * 100 : 0;
      const criticalBarWidth = (totalWidth * criticalWidth) / 100;
      const tooltip = `${item.supervisor}: ${formatNumber(item.total)} متدرب، منها ${formatNumber(item.criticalCount)} حالات حرجة. ${getTraineeTooltip(item.items, "لا توجد حالات مرتبطة.")}`;

      return `
        <button
          class="supervisor-load__row${item.previewTrainee ? " supervisor-load__row--interactive" : ""}"
          type="button"
          ${item.previewTrainee ? `data-action="open-trainee" data-trainee-id="${item.previewTrainee.id}"` : "disabled"}
          title="${escapeHtml(tooltip)}"
        >
          <div class="supervisor-load__header">
            <div class="supervisor-load__meta">
              <strong>${item.supervisor}</strong>
              <span>${formatNumber(item.total)} متدرب</span>
            </div>
            <span class="pill ${getStatusTone("عاجل").className}">
              ${formatNumber(item.criticalCount)} حرجة
            </span>
          </div>
          <div class="supervisor-load__track">
            <span class="supervisor-load__bar" style="--supervisor-bar-width:${totalWidth}%; width:${totalWidth}%"></span>
            <span class="supervisor-load__critical" style="--supervisor-critical-width:${criticalBarWidth}%; width:${criticalBarWidth}%"></span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderMeetingActionPanel() {
  const container = document.getElementById("meeting-action-panel");
  const counter = document.getElementById("meeting-actions-count");
  const items = getMeetingActionItems();

  counter.textContent = `${formatNumber(items.length)} حالات`;

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">لا توجد حالات ضمن هذا النطاق حاليًا.</div>`;
    return;
  }

  container.innerHTML = items
    .map(
      (trainee) => `
        <article
          class="meeting-action-item"
          title="${escapeHtml(`${trainee.name} - ${trainee.department} - ${getRemainingDaysLabel(trainee.daysLeft)}`)}"
        >
          <div class="meeting-action-item__main">
            <strong class="meeting-action-item__name">${trainee.name}</strong>
            <span class="meeting-action-item__meta">${trainee.department}</span>
          </div>
          <div class="meeting-action-item__status">
            <span class="meeting-action-item__days">${getRemainingDaysLabel(trainee.daysLeft)}</span>
            ${renderStatusBadge(trainee.status, trainee.statusTone)}
          </div>
          <button
            class="action-button action-button--ghost action-button--table meeting-action-item__action"
            type="button"
            data-action="open-trainee"
            data-trainee-id="${trainee.id}"
          >
            عرض
          </button>
        </article>
      `,
    )
    .join("");
}

function renderBarChart(containerId, items) {
  const container = document.getElementById(containerId);
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  container.innerHTML = items
    .map(
      (item) => `
        <div class="chart-row">
          <span class="chart-row__label">${item.label}</span>
          <div class="chart-row__track">
            <div
              class="chart-row__bar"
              style="width:${(item.value / maxValue) * 100}%; background:${item.color}"
            ></div>
          </div>
          <span class="chart-row__value">${formatNumber(item.value)}</span>
        </div>
      `,
    )
    .join("");
}

function renderColumnChart(containerId, items) {
  const container = document.getElementById(containerId);
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  container.innerHTML = `
    <div class="column-chart">
      ${items
        .map(
          (item) => `
            <div class="column-chart__item">
              <span class="column-chart__value">${formatNumber(item.value)}</span>
              <div class="column-chart__bar-wrap">
                <div
                  class="column-chart__bar"
                  style="height:${(item.value / maxValue) * 100}%; background:${item.color}"
                ></div>
              </div>
              <span class="column-chart__label">${item.label}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDashboardNearestTable() {
  const tbody = document.getElementById("dashboard-trainees-table");
  const counter = document.getElementById("dashboard-nearest-count");
  const trainees = getDashboardNearestTrainees();

  if (counter) {
    counter.textContent = `${formatNumber(trainees.length)} حالات`;
  }

  if (!trainees.length) {
    tbody.innerHTML = `
      <tr>
        <td class="data-table__empty" colspan="5">لا توجد نتائج مطابقة في لوحة التحكم.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = trainees
    .map(
      (trainee) => `
        <tr
          class="dashboard-nearest-row dashboard-nearest-row--${trainee.status === "عاجل" ? "urgent" : trainee.status === "قريب انتهاء" ? "near" : "active"}"
          data-action="open-trainee"
          data-trainee-id="${trainee.id}"
          title="${escapeHtml(`${trainee.name} - ${trainee.department} - ${getRemainingDaysLabel(trainee.daysLeft)}`)}"
        >
          <td>
            <div class="data-table__primary">
              <strong>${trainee.name}</strong>
              <span>إشراف: ${trainee.supervisor}</span>
            </div>
          </td>
          <td><span class="data-table__department">${trainee.department}</span></td>
          <td><span class="data-table__date">${formatDate(trainee.endDate)}</span></td>
          <td>
            <span class="data-table__days-pill data-table__days-pill--${trainee.status === "عاجل" ? "urgent" : trainee.status === "قريب انتهاء" ? "near" : "active"}">
              ${formatNumber(trainee.daysLeft)} يوم
            </span>
          </td>
          <td>${renderStatusBadge(trainee.status, trainee.statusTone)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderDashboardExecutiveMetrics() {
  const container = document.getElementById("dashboard-exec-metrics");

  if (!container) {
    return;
  }

  container.innerHTML = getDashboardExecutiveMetrics()
    .map(
      (metric) => `
        <article class="dashboard-exec-metric${metric.featured ? " dashboard-exec-metric--featured" : ""}${metric.tone ? ` dashboard-exec-metric--${metric.tone}` : ""}">
          <span class="dashboard-exec-metric__label">${metric.label}</span>
          <strong class="dashboard-exec-metric__value" data-count-target="${metric.value}">${formatNumber(metric.value)}</strong>
          <p class="dashboard-exec-metric__detail">${metric.detail}</p>
        </article>
      `,
    )
    .join("");
}

function renderDashboardExecutiveHero() {
  const overview = getDashboardExecutiveOverview();
  const titleElement = document.getElementById("dashboard-exec-hero-title");
  const summaryElement = document.getElementById("dashboard-exec-hero-summary");

  if (titleElement) {
    titleElement.textContent = overview.headline;
  }

  if (summaryElement) {
    summaryElement.textContent = overview.summary;
  }
}

function renderDashboardExecutiveActions() {
  const container = document.getElementById("dashboard-exec-actions");
  const items = getDashboardExecutiveActionItems();

  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">لا توجد حالات حرجة حاليًا، ويمكن متابعة بقية الملفات عبر صفحة التنبيهات.</div>`;
    return;
  }

  container.innerHTML = items
    .map(
      (trainee) => `
        <article class="dashboard-exec-action-item">
          <div class="dashboard-exec-action-item__main">
            <strong>${trainee.name}</strong>
            <span>${trainee.department}</span>
          </div>
          <div class="dashboard-exec-action-item__meta">
            <span>${getRemainingDaysLabel(trainee.daysLeft)}</span>
            ${renderStatusBadge(trainee.status, trainee.statusTone)}
          </div>
          <button
            class="action-button action-button--ghost action-button--table"
            type="button"
            data-action="open-trainee"
            data-trainee-id="${trainee.id}"
          >
            عرض الملف
          </button>
        </article>
      `,
    )
    .join("");
}

function renderDashboardDepartmentFocus() {
  const container = document.getElementById("dashboard-department-focus");
  const items = getDashboardExecutiveDepartmentFocus();
  const maxAttention = Math.max(...items.map((item) => item.attentionCount), 1);

  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">لا توجد بيانات كافية لبناء قراءة تنفيذية حسب الإدارة.</div>`;
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
        <article class="dashboard-department-focus-item">
          <div class="dashboard-department-focus-item__head">
            <div>
              <strong>${item.department}</strong>
              <span>${formatNumber(item.total)} متدرب</span>
            </div>
            <span class="dashboard-department-focus-item__count">${formatNumber(item.attentionCount)}</span>
          </div>
          <div class="dashboard-department-focus-item__track">
            <span class="dashboard-department-focus-item__bar" style="width:${Math.max((item.attentionCount / maxAttention) * 100, item.attentionCount ? 12 : 0)}%"></span>
          </div>
          <p class="dashboard-department-focus-item__meta">
            عاجل: ${formatNumber(item.urgentCount)} · قريب: ${formatNumber(item.expiringSoonCount)} · ناقص: ${formatNumber(item.missingCount)}
          </p>
        </article>
      `,
    )
    .join("");
}

function renderDashboardExecutiveRoutes() {
  const container = document.getElementById("dashboard-exec-routes");

  if (!container) {
    return;
  }

  container.innerHTML = getDashboardExecutiveRouteCards()
    .map(
      (item) => `
        <button
          class="dashboard-route-card"
          type="button"
          data-action="open-dashboard-view"
          data-view="${item.view}"
        >
          <span class="dashboard-route-card__label">${item.label}</span>
          <strong class="dashboard-route-card__value">${formatNumber(item.value)}</strong>
          <p class="dashboard-route-card__detail">${item.detail}</p>
        </button>
      `,
    )
    .join("");
}

function renderTraineesDirectoryTable() {
  const tbody = document.getElementById("directory-table-body");
  const counter = document.getElementById("directory-count");
  const trainees = filterTraineesDirectory().sort((left, right) => {
    if (left.daysLeft !== right.daysLeft) {
      return left.daysLeft - right.daysLeft;
    }

      return left.endDate.localeCompare(right.endDate);
    });

  renderTraineesKpiCards();

  if (!tbody || !counter) {
    return;
  }

  counter.textContent = `${formatNumber(trainees.length)} متدرب`;

  if (!trainees.length) {
    tbody.innerHTML = `
      <tr>
        <td class="data-table__empty" colspan="7">لا توجد نتائج مطابقة للفلاتر الحالية.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = trainees
    .map(
      (trainee) => `
        <tr>
          <td>${trainee.name}</td>
          <td>${trainee.department}</td>
          <td>${formatDate(trainee.startDate)}</td>
          <td>${formatDate(trainee.endDate)}</td>
          <td>${trainee.daysLeft < 0 ? `منتهٍ` : `${formatNumber(trainee.daysLeft)} يوم`}</td>
          <td>${renderStatusBadge(trainee.status, trainee.statusTone)}</td>
          <td>
            <div class="table-actions">
              <button
                class="action-button action-button--ghost action-button--table"
                type="button"
                data-action="open-trainee"
                data-trainee-id="${trainee.id}"
              >
                عرض التفاصيل
              </button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderAlertsSections() {
  const alertsGrid = document.getElementById("alerts-grid");
  const sortByEnding = (trainees) =>
    [...trainees].sort((left, right) => {
      if (left.daysLeft < 0 && right.daysLeft < 0) {
        return right.daysLeft - left.daysLeft;
      }

      if (left.daysLeft !== right.daysLeft) {
        return left.daysLeft - right.daysLeft;
      }

      return left.endDate.localeCompare(right.endDate);
    });

  const alertGroups = [
    {
      title: "سينتهون خلال 7 أيام",
      key: "within7",
      tone: "warning",
      items: sortByEnding(getAlertsData().within7),
      priority: true,
    },
    {
      title: "سينتهون خلال 30 يوم",
      key: "within30",
      tone: "info",
      items: sortByEnding(getAlertsData().within30),
    },
    {
      title: "منتهية فترتهم",
      key: "expired",
      tone: "danger",
      items: sortByEnding(getAlertsData().expired),
    },
    {
      title: "بيانات ناقصة",
      key: "missingData",
      tone: "accent",
      items: sortByEnding(getAlertsData().missingData),
    },
  ];

  alertsGrid.innerHTML = alertGroups
    .map(
      (group) => `
        <article
          id="alert-group-${group.key}"
          class="card alert-panel${group.priority ? " alert-panel--priority" : ""}${uiState.alertsFocusGroup === group.key ? " alert-panel--focused" : ""}"
        >
          <div class="alert-panel__header">
            <h3 class="section-title">${group.title}</h3>
            <span class="pill pill--${group.tone}">
              ${formatNumber(group.items.length)}
            </span>
          </div>
          <div class="alert-list">
            ${
              group.items.length
                ? group.items
                    .map(
                      (trainee) => `
                        <div class="alert-row${uiState.alertsFocusTraineeId === trainee.id ? " alert-row--focused" : ""}">
                          <span class="alert-row__main">
                            <strong>${trainee.name}</strong>
                            <span>${trainee.department}</span>
                          </span>
                          <span class="alert-row__meta">
                            <span class="alert-row__days">${getRemainingDaysLabel(trainee.daysLeft)}</span>
                            <button
                              class="action-button action-button--ghost action-button--table"
                              type="button"
                              data-action="open-trainee"
                              data-trainee-id="${trainee.id}"
                            >
                              عرض التفاصيل
                            </button>
                          </span>
                        </div>
                      `,
                    )
                    .join("")
                : `<div class="empty-state">لا توجد حالات ضمن هذا القسم حاليًا.</div>`
            }
          </div>
        </article>
      `,
    )
    .join("");

  if (uiState.alertsFocusGroup) {
    requestAnimationFrame(() => {
      const focusedGroup = document.getElementById(`alert-group-${uiState.alertsFocusGroup}`);

      if (focusedGroup) {
        focusedGroup.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
}

function renderReportsView() {
  const filteredTrainees = filterReportTrainees();
  const reportSummary = [
    {
      label: "إجمالي السجلات",
      value: filteredTrainees.length,
      meta: "عدد الحالات ضمن التقرير الحالي",
      tone: "accent",
    },
    {
      label: "النشطون",
      value: filteredTrainees.filter((trainee) => trainee.status === "نشط").length,
      meta: "حالات مستقرة لا تتطلب إجراء عاجل",
      tone: "success",
    },
    {
      label: "قريبة الانتهاء",
      value: filteredTrainees.filter((trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30).length,
      meta: "حالات تحتاج متابعة خلال الفترة القريبة",
      tone: "info",
    },
    {
      label: "بيانات ناقصة",
      value: filteredTrainees.filter((trainee) => trainee.missingData).length,
      meta: "ملفات تتطلب استكمال البيانات والمستندات",
      tone: "warning",
    },
  ];

  document.getElementById("reports-summary").innerHTML = reportSummary
    .map(
      (card) => `
        <article class="card summary-card summary-card--report summary-card--${card.tone}">
          <span class="summary-card__accent"></span>
          <p class="summary-card__label">${card.label}</p>
          <h4 class="summary-card__value">${formatNumber(card.value)}</h4>
          <p class="summary-card__meta">${card.meta}</p>
        </article>
      `,
    )
    .join("");

  renderBarChart("reports-chart", getDepartmentDistribution(filteredTrainees));

  const departmentRows = getDepartmentDistribution(filteredTrainees);
  const tableBody = document.getElementById("reports-table-body");

  if (!departmentRows.length) {
    tableBody.innerHTML = `
      <tr>
        <td class="data-table__empty" colspan="3">لا توجد بيانات متاحة لهذه التصفية.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = departmentRows
    .map((department) => {
      const departmentTrainees = filteredTrainees.filter(
        (trainee) => trainee.department === department.label,
      );
      const nearEndingCount = departmentTrainees.filter(
        (trainee) => trainee.daysLeft >= 0 && trainee.daysLeft <= 30,
      ).length;

      return `
        <tr>
          <td>${department.label}</td>
          <td>${formatNumber(department.value)}</td>
          <td>${formatNumber(nearEndingCount)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderDashboardView() {
  renderDashboardExecutiveMetrics();
  renderDashboardStatusRing();
  renderDashboardExecutiveActions();
  renderDashboardDepartmentFocus();
  renderDashboardExecutiveRoutes();
  setupDashboardMotion();
}

function renderIndicatorsView() {
  renderCurrentView();
}

async function uploadIndicatorsFile(file) {
  if (!file) {
    return;
  }

  const lowerName = file.name.toLowerCase();
  const isSupported = [".xlsx", ".xls", ".csv"].some((extension) => lowerName.endsWith(extension));

  if (!isSupported) {
    uiState.indicatorsUploadState = "error";
    uiState.indicatorsUploadError = "نوع الملف غير مدعوم. ارفع ملف Excel أو CSV.";
    renderCurrentView();
    return;
  }

  uiState.indicatorsUploadName = file.name;
  uiState.indicatorsUploadState = "uploading";
  uiState.indicatorsUploadError = "";
  renderCurrentView();

  try {
    const fileBase64 = await readFileAsBase64(file);
    const payload = await apiRequest(API_ENDPOINTS.analyzeIndicators, {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        fileBase64,
      }),
    });

    uiState.indicatorsAnalysis = payload.analysis;
    uiState.indicatorsUploadState = "ready";
    uiState.indicatorsUploadError = "";
  } catch (error) {
    uiState.indicatorsAnalysis = null;
    uiState.indicatorsUploadState = "error";
    uiState.indicatorsUploadError = error.message || "تعذر تحليل الملف المرفوع.";
  }

  renderCurrentView();
}

async function runIndicatorsApiExperiment() {
  const file = uiState.indicatorsSelectedFile;

  if (!file) {
    uiState.indicatorsApiExperimentState = "error";
    uiState.indicatorsApiExperimentError = "اختر ملفًا أولًا قبل تجربة تحليل API.";
    uiState.indicatorsApiExperimentResult = null;
    renderCurrentView();
    return;
  }

  uiState.indicatorsApiExperimentState = "uploading";
  uiState.indicatorsApiExperimentError = "";
  renderCurrentView();

  try {
    const formData = new FormData();
    formData.append("file", file, file.name);

    const response = await fetch(ANALYSIS_API_EXPERIMENT_URL, {
      method: "POST",
      body: formData,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.detail || payload?.message || "فشل الاتصال بخدمة التحليل");
    }

    uiState.indicatorsApiExperimentResult = payload;
    uiState.indicatorsApiExperimentState = "ready";
    uiState.indicatorsApiExperimentError = "";
  } catch (error) {
    uiState.indicatorsApiExperimentResult = null;
    uiState.indicatorsApiExperimentState = "error";
    uiState.indicatorsApiExperimentError = error?.message || "فشل الاتصال بخدمة التحليل";
  }

  renderCurrentView();
}

function animateCountValue(element, target, delay) {
  if (!element) {
    return;
  }

  if (prefersReducedMotion()) {
    element.textContent = formatNumber(target);
    return;
  }

  const duration = 760;
  const startAt = performance.now() + delay;

  const tick = (now) => {
    if (now < startAt) {
      requestAnimationFrame(tick);
      return;
    }

    const progress = Math.min((now - startAt) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = formatNumber(Math.round(target * eased));

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      element.textContent = formatNumber(target);
    }
  };

  requestAnimationFrame(tick);
}

function setupDashboardMotion() {
  const pageView = document.querySelector(".page-view");

  if (!pageView || uiState.currentView !== "dashboard") {
    return;
  }

  pageView.classList.remove("dashboard-motion-ready");

  let order = 0;
  const motionSelectors = [
    ".dashboard-exec-hero",
    ".dashboard-exec-metric",
    ".dashboard-exec-panel",
    ".dashboard-exec-action-item",
    ".dashboard-department-focus-item",
    ".dashboard-route-card",
    ".status-ring-card__visual",
    ".status-ring-card__legend-row",
  ];

  motionSelectors.forEach((selector) => {
    pageView.querySelectorAll(selector).forEach((element) => {
      element.style.setProperty("--motion-order", String(order));
      order += 1;
    });
  });

  pageView.querySelectorAll("[data-count-target]").forEach((element, index) => {
    animateCountValue(element, Number(element.dataset.countTarget), index * 90);
  });

  if (dashboardMotionFrame) {
    cancelAnimationFrame(dashboardMotionFrame);
  }

  dashboardMotionFrame = requestAnimationFrame(() => {
    dashboardMotionFrame = requestAnimationFrame(() => {
      pageView.classList.add("dashboard-motion-ready");
    });
  });
}

function initializeScrollReveal() {
  if (scrollRevealObserver) {
    scrollRevealObserver.disconnect();
  }

  scrollRevealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        scrollRevealObserver.unobserve(entry.target);
      });
    },
    {
      threshold: 0.14,
      rootMargin: "0px 0px -10% 0px",
    },
  );

  const revealGroups = [
    {
      selector: ".topbar, .page-view > .section-block, .page-view > .card",
      itemClass: "",
      step: 70,
      limit: 280,
    },
    {
      selector:
        ".summary-card, .action-card, .priority-item, .meeting-action-item, .alert-panel, .detail-card, .setting-row, .forecast-item, .supervisor-load__row, .heatmap-table__row, .data-table tbody tr",
      itemClass: " scroll-reveal--item",
      step: 36,
      limit: 220,
    },
  ];

  revealGroups.forEach((group) => {
    document.querySelectorAll(group.selector).forEach((element, index) => {
      element.classList.remove("is-visible");
      element.classList.add("scroll-reveal");

      if (group.itemClass) {
        element.classList.add(group.itemClass.trim());
      }

      element.style.setProperty("--reveal-delay", `${Math.min(index * group.step, group.limit)}ms`);
      scrollRevealObserver.observe(element);
    });
  });
}

function renderCurrentView() {
  document.body.dataset.view = uiState.currentView;
  document.body.dataset.pageLayout = usesUnifiedPageLayout(uiState.currentView) ? "unified" : "legacy";
  restoreTopbarMetaToHeader();
  document.getElementById("page-content").innerHTML = getCurrentViewTemplate();
  updateTopbarForCurrentView();
  syncUnifiedToolbarPlacement();
  renderNotificationCenter();
  renderSidebarFooter();

  switch (uiState.currentView) {
    case "dashboard":
      renderDashboardView();
      break;
    case "indicators":
      break;
    case "trainees":
      renderTraineesDirectoryTable();
      break;
    case "alerts":
      renderAlertsSections();
      break;
    case "reports":
      renderReportsView();
      break;
    default:
      break;
  }

  initializeScrollReveal();
}

function resetPrimaryScrollPosition() {
  const mainContent = document.querySelector(".main-content");
  const pageContent = document.getElementById("page-content");

  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  if (mainContent) {
    mainContent.scrollTop = 0;
  }

  if (pageContent) {
    pageContent.scrollTop = 0;
  }

  requestAnimationFrame(() => {
    window.scrollTo(0, 0);

    if (mainContent) {
      mainContent.scrollTop = 0;
    }

    if (pageContent) {
      pageContent.scrollTop = 0;
    }
  });
}

function renderAuthState() {
  const authShell = document.getElementById("auth-shell");
  const appShell = document.querySelector(".app-shell");
  const isAuthTransitionActive =
    uiState.isAuthenticated && document.body.dataset.authTransition !== "idle";

  document.body.dataset.auth = uiState.isAuthenticated ? "authenticated" : "guest";

  if (uiState.isAuthenticated) {
    appShell.removeAttribute("hidden");

    if (isAuthTransitionActive) {
      authShell.removeAttribute("hidden");
    } else {
      authShell.setAttribute("hidden", "");
    }

    return;
  }

  appShell.setAttribute("hidden", "");
  authShell.removeAttribute("hidden");
}

function setLogoReady(isReady) {
  document.body.dataset.logoReady = isReady ? "true" : "false";
}

function setAuthTransitionStage(stage) {
  document.body.dataset.authTransition = stage;
}

function setAuthenticationState(isAuthenticated, user = null, options = {}) {
  uiState.isAuthenticated = isAuthenticated;
  uiState.sessionUser = isAuthenticated ? user : null;
  uiState.notificationsOpen = false;
  const feedback = document.getElementById("login-feedback");
  const shouldDeferLogoReveal = Boolean(options.deferLogoReveal);

  if (isAuthenticated && user) {
    safeWriteStorage(
      STORAGE_KEYS.session,
      JSON.stringify({
        username: user.username,
        name: user.name,
        role: user.role,
      }),
    );
  } else {
    clearStorageKey(STORAGE_KEYS.session);
  }

  renderAuthState();

  if (isAuthenticated) {
    setSidebarState("collapsed");
    setLogoReady(!shouldDeferLogoReveal);
    updateNavigationState();
    renderCurrentDate();
    renderSidebarFooter();
    renderCurrentView();
    resetPrimaryScrollPosition();
    document.getElementById("login-form").reset();
    feedback.textContent = "";
    delete feedback.dataset.state;
    return;
  }

  setLogoReady(false);
  setAuthTransitionStage("idle");
  uiState.currentView = "dashboard";
  document.getElementById("login-password").value = "";
  feedback.textContent = "";
  delete feedback.dataset.state;
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function setIntroStage(stage) {
  document.body.dataset.intro = stage;
}

function getElementViewportOffset(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return null;
  }

  return {
    rect,
    x: rect.left + rect.width / 2 - window.innerWidth / 2,
    y: rect.top + rect.height / 2 - window.innerHeight / 2,
  };
}

async function playInitialIntro() {
  const introSplash = document.getElementById("intro-splash");
  const introLogo = introSplash?.querySelector(".intro-splash__logo");
  const transition = document.getElementById("login-transition");
  const authLogo = document.querySelector(".auth-card__logo");

  if (!introSplash) {
    setIntroStage("revealed");
    return;
  }

  await wait(INTRO_SPLASH_DURATION);

  if (!transition || !introLogo || !authLogo || prefersReducedMotion()) {
    setIntroStage("revealed");
    introSplash.classList.add("intro-splash--exit");
    await wait(320);
    introSplash.hidden = true;

    if (!uiState.isAuthenticated) {
      document.getElementById("login-username")?.focus();
    }

    return;
  }

  const start = getElementViewportOffset(introLogo);
  const target = getElementViewportOffset(authLogo);

  if (!start || !target) {
    setIntroStage("revealed");
    introSplash.classList.add("intro-splash--exit");
    await wait(320);
    introSplash.hidden = true;

    if (!uiState.isAuthenticated) {
      document.getElementById("login-username")?.focus();
    }

    return;
  }

  transition.hidden = false;
  transition.classList.remove("login-transition--active", "login-transition--settling", "login-transition--reveal", "login-transition--pulse");
  transition.style.setProperty("--login-logo-width", `${start.rect.width}px`);
  transition.style.setProperty("--login-logo-glow-width", `${Math.max(start.rect.width * 1.8, 132)}px`);
  transition.style.setProperty("--login-logo-x", `${start.x}px`);
  transition.style.setProperty("--login-logo-y", `${start.y}px`);
  transition.style.setProperty("--login-logo-scale", "1");

  setIntroStage("transitioning");
  await waitForNextFrame();
  transition.classList.add("login-transition--active");
  introSplash.classList.add("intro-splash--exit");
  await waitForNextFrame();
  transition.style.setProperty("--login-logo-x", `${target.x}px`);
  transition.style.setProperty("--login-logo-y", `${target.y}px`);
  transition.style.setProperty("--login-logo-scale", "1");
  transition.style.setProperty("--login-logo-glow-width", `${Math.max(target.rect.width * 1.75, 120)}px`);

  await wait(760);
  setIntroStage("blending");
  await wait(360);
  setIntroStage("revealed");
  transition.classList.add("login-transition--reveal");
  await wait(420);
  introSplash.hidden = true;
  transition.hidden = true;
  transition.classList.remove("login-transition--active", "login-transition--settling", "login-transition--reveal", "login-transition--pulse");
  transition.style.removeProperty("--login-logo-width");
  transition.style.removeProperty("--login-logo-glow-width");
  transition.style.removeProperty("--login-logo-x");
  transition.style.removeProperty("--login-logo-y");
  transition.style.removeProperty("--login-logo-scale");

  if (!uiState.isAuthenticated) {
    document.getElementById("login-username")?.focus();
  }
}

async function playLoginTransition(user) {
  const transition = document.getElementById("login-transition");
  const transitionLogo = document.getElementById("login-transition-logo");

  if (!transition || !transitionLogo || prefersReducedMotion()) {
    setAuthenticationState(true, user);
    return;
  }

  setLogoReady(false);
  setAuthTransitionStage("loading");
  transition.hidden = false;
  transition.classList.remove("login-transition--settling", "login-transition--reveal", "login-transition--pulse");
  transition.style.setProperty("--login-logo-x", "0px");
  transition.style.setProperty("--login-logo-y", "-28px");
  transition.style.setProperty("--login-logo-scale", "0.9");

  await waitForNextFrame();
  transition.classList.add("login-transition--active");
  await waitForNextFrame();
  transition.style.setProperty("--login-logo-y", "0px");
  transition.style.setProperty("--login-logo-scale", "1");

  await wait(360);
  transition.classList.add("login-transition--pulse");
  await wait(260);
  transition.classList.remove("login-transition--pulse");
  setAuthenticationState(true, user, { deferLogoReveal: true });
  await waitForNextFrame();
  await waitForNextFrame();
  transition.classList.add("login-transition--reveal");
  setAuthTransitionStage("reveal");
  renderAuthState();
  await wait(180);
  setLogoReady(true);
  await wait(520);
  setAuthTransitionStage("idle");
  renderAuthState();
  transition.classList.remove("login-transition--active", "login-transition--reveal", "login-transition--pulse");

  transition.hidden = true;
  transition.style.removeProperty("--login-logo-x");
  transition.style.removeProperty("--login-logo-y");
  transition.style.removeProperty("--login-logo-scale");
}

function handleLoginSubmit(event) {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const feedback = document.getElementById("login-feedback");
  const submitButton = document.getElementById("login-submit");

  if (!username || !password) {
    feedback.textContent = "أدخل اسم المستخدم وكلمة المرور للمتابعة.";
    feedback.dataset.state = "error";
    return;
  }

  submitButton.disabled = true;
  feedback.textContent = "جارٍ التحقق من الهوية من الخادم.";
  feedback.dataset.state = "success";

  apiRequest(API_ENDPOINTS.login, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
    .then((payload) => {
      feedback.textContent = "تم التحقق من الهوية. جارٍ فتح النظام.";
      feedback.dataset.state = "success";
      return playLoginTransition(payload.user);
    })
    .catch((error) => {
      feedback.textContent = error.message || "تعذر تسجيل الدخول حاليًا.";
      feedback.dataset.state = "error";
    })
    .finally(() => {
      submitButton.disabled = false;
    });
}

function logout() {
  setAuthenticationState(false);
  document.getElementById("login-username").focus();
}

function initializeAuth() {
  const savedSession = safeReadJsonStorage(STORAGE_KEYS.session, null);
  const authUser = getApiAuthUser();

  renderAuthState();
  document.getElementById("login-form").addEventListener("submit", handleLoginSubmit);

  if (!savedSession?.username || !authUser) {
    return;
  }

  setAuthenticationState(true, {
    ...authUser,
    ...savedSession,
  });
}

function updateNavigationState() {
  const activeView = uiState.currentView === "trainee-details" ? "trainees" : uiState.currentView;

  document.querySelectorAll(".nav-link").forEach((link) => {
    const isActive = link.dataset.view === activeView;
    link.classList.toggle("nav-link--active", isActive);

    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function renderSidebarFooter() {
  const container = document.getElementById("sidebar-footer");

  if (!container || !uiState.isAuthenticated) {
    container.innerHTML = "";
    return;
  }

  const currentViewMeta = viewMeta[uiState.currentView];
  const isDarkTheme = document.body.dataset.theme === "dark";
  const quickLink =
    uiState.currentView === "dashboard"
      ? { view: "trainees", label: "خانة المتدربين" }
      : { view: "dashboard", label: "العودة للرئيسية" };

  container.innerHTML = `
    <div class="sidebar-panel">
      <p class="sidebar-panel__eyebrow">الوصول السريع</p>
      <strong class="sidebar-panel__title">${currentViewMeta.title}</strong>
      <p class="sidebar-panel__text">
        الحالة الحالية: ${isDarkTheme ? "الوضع الليلي" : "الوضع النهاري"}
        <br />
        المستخدم: ${escapeHtml(uiState.sessionUser?.name || "المستخدم الإداري")}
      </p>
      <div class="sidebar-panel__actions">
        <button
          class="sidebar-panel__action sidebar-panel__action--primary"
          type="button"
          data-sidebar-action="toggle-theme"
        >
          ${isDarkTheme ? "الوضع النهاري" : "الوضع الليلي"}
        </button>
        <button
          class="sidebar-panel__action"
          type="button"
          data-sidebar-action="navigate"
          data-sidebar-view="${quickLink.view}"
        >
          ${quickLink.label}
        </button>
        <button
          class="sidebar-panel__action"
          type="button"
          data-sidebar-action="logout"
        >
          تسجيل الخروج
        </button>
      </div>
    </div>
  `;
}

function navigateTo(view, options = {}) {
  uiState.notificationsOpen = false;

  if (options.traineeId) {
    uiState.selectedTraineeId = options.traineeId;
  }

  if (Object.prototype.hasOwnProperty.call(options, "alertGroup")) {
    uiState.alertsFocusGroup = options.alertGroup;
  } else {
    uiState.alertsFocusGroup = null;
  }

  if (Object.prototype.hasOwnProperty.call(options, "alertTraineeId")) {
    uiState.alertsFocusTraineeId = options.alertTraineeId;
  } else {
    uiState.alertsFocusTraineeId = null;
  }

  uiState.currentView = view;
  updateNavigationState();
  renderCurrentView();
  resetPrimaryScrollPosition();
}

function setTheme(theme) {
  const themeToggleText = document.getElementById("theme-toggle-text");
  const themeToggleButton = document.getElementById("theme-toggle");
  const nextLabel = theme === "dark" ? "الوضع النهاري" : "الوضع الليلي";

  document.body.dataset.theme = theme;
  themeToggleText.textContent = nextLabel;
  themeToggleButton.setAttribute("aria-label", `تفعيل ${nextLabel}`);
  themeToggleButton.setAttribute("title", `تفعيل ${nextLabel}`);
  themeToggleButton.setAttribute("aria-pressed", String(theme === "dark"));
  safeWriteStorage(STORAGE_KEYS.theme, theme);
  renderSidebarFooter();
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
  renderCurrentDate();

  if (uiState.currentView === "settings") {
    renderCurrentView();
  }
}

function setSidebarState(sidebarState) {
  const sidebarToggleButton = document.getElementById("sidebar-toggle");
  const sidebarToggleText = sidebarToggleButton.querySelector(".control-button__text");
  const isCollapsed = sidebarState === "collapsed";
  const label = isCollapsed ? "توسيع القائمة" : "تصغير القائمة";

  document.body.dataset.sidebar = sidebarState;
  sidebarToggleText.textContent = label;
  sidebarToggleButton.setAttribute("aria-label", label);
  sidebarToggleButton.setAttribute("title", label);
  sidebarToggleButton.setAttribute("aria-pressed", String(isCollapsed));
  safeWriteStorage(STORAGE_KEYS.sidebar, sidebarState);
  renderSidebarFooter();
}

function toggleSidebar() {
  const nextSidebarState =
    document.body.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";

  setSidebarState(nextSidebarState);

  if (uiState.currentView === "settings") {
    renderCurrentView();
  }
}

function syncTopbarSearchInput(value) {
  const topbarSearchInput = document.getElementById("search-input");
  topbarSearchInput.value = value;
}

function updateCardSelection(cardGroup, cardIndex) {
  if (cardGroup === "summary") {
    uiState.activeSummaryCard = uiState.activeSummaryCard === cardIndex ? null : cardIndex;

    if (uiState.currentView === "indicators") {
      renderSummaryCards(getIndicatorsSummaryCards());
    } else {
      renderSummaryCards();
    }

    return;
  }

  if (cardGroup === "action") {
    uiState.activeActionCard = uiState.activeActionCard === cardIndex ? null : cardIndex;
    renderActionCards();
  }
}

function handleTopbarSearchInput(event) {
  const value = event.target.value;

  switch (uiState.currentView) {
    case "dashboard":
      uiState.dashboardSearch = value;
      renderDashboardView();
      break;
    case "indicators":
      uiState.dashboardSearch = value;
      renderIndicatorsView();
      break;
    case "trainees": {
      uiState.traineesFilters.search = value;
      const localSearch = document.getElementById("trainees-local-search");
      if (localSearch) {
        localSearch.value = value;
      }
      renderTraineesDirectoryTable();
      break;
    }
    case "alerts":
      uiState.alertSearch = value;
      renderAlertsSections();
      break;
    case "reports":
      uiState.reportSearch = value;
      renderReportsView();
      break;
    default:
      break;
  }
}

function handlePageContentClick(event) {
  const interactiveCard = event.target.closest(".card--interactive");

  if (interactiveCard) {
    updateCardSelection(
      interactiveCard.dataset.cardGroup,
      Number(interactiveCard.dataset.cardIndex),
    );
    return;
  }

  const actionTarget = event.target.closest("[data-action]");

  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;

  switch (action) {
    case "open-trainee":
      navigateTo("trainee-details", {
        traineeId: Number(actionTarget.dataset.traineeId),
      });
      break;
    case "set-priority-tab":
      uiState.dashboardPriorityTab = actionTarget.dataset.priorityTab;
      renderDashboardPrioritySection();
      break;
    case "open-alert-focus":
      navigateTo("alerts", {
        alertGroup: actionTarget.dataset.alertGroup,
        alertTraineeId: Number(actionTarget.dataset.traineeId),
      });
      break;
    case "open-dashboard-view":
      navigateTo(actionTarget.dataset.view);
      break;
    case "mark-priority-followed": {
      const traineeId = Number(actionTarget.dataset.traineeId);

      if (!uiState.followedPriorityIds.includes(traineeId)) {
        uiState.followedPriorityIds.push(traineeId);
      }

      renderDashboardPrioritySection();
      renderActionCards();
      renderSummaryCards();
      renderMeetingActionPanel();
      break;
    }
    case "back-to-trainees":
      navigateTo("trainees");
      break;
    case "reset-trainees-filters":
      uiState.traineesFilters = {
        search: "",
        department: "all",
        status: "all",
        remaining: "all",
      };
      renderCurrentView();
      break;
    case "toggle-theme-setting":
      toggleTheme();
      break;
    case "toggle-sidebar-setting":
      toggleSidebar();
      break;
    case "toggle-setting":
      toggleGeneralSetting(actionTarget.dataset.settingKey);
      break;
    case "focus-basic-info":
      focusTraineeBasicInfo();
      break;
    case "update-trainee-status":
      updateSelectedTraineeStatus();
      break;
    case "add-trainee-note":
      addMockTraineeNote();
      break;
    case "export-report-csv":
      exportCurrentReportAsCsv();
      break;
    case "export-indicators-powerbi":
      exportIndicatorsPowerBiPackage();
      break;
    case "test-indicators-api":
      if (
        uiState.indicatorsApiExperimentState !== "uploading" &&
        uiState.indicatorsSelectedFile
      ) {
        runIndicatorsApiExperiment();
      }
      break;
    case "print-report":
      window.print();
      break;
    case "clear-indicators-analysis":
      uiState.indicatorsAnalysis = null;
      uiState.indicatorsUploadState = "idle";
      uiState.indicatorsUploadName = "";
      uiState.indicatorsUploadError = "";
      uiState.indicatorsSelectedFile = null;
      uiState.indicatorsApiExperimentState = "idle";
      uiState.indicatorsApiExperimentResult = null;
      uiState.indicatorsApiExperimentError = "";
      uiState.dashboardSearch = "";
      renderCurrentView();
      break;
    default:
      break;
  }
}

function handlePageContentInput(event) {
  if (event.target.id === "trainees-local-search") {
    uiState.traineesFilters.search = event.target.value;
    syncTopbarSearchInput(event.target.value);
    renderTraineesDirectoryTable();
  }
}

function handlePageContentChange(event) {
  switch (event.target.id) {
    case "dashboard-insight-department":
      uiState.dashboardInsightDepartment = event.target.value;
      renderHeatmap();
      renderForecastChart();
      renderSupervisorLoadChart();
      renderMeetingActionPanel();
      setupDashboardMotion();
      break;
    case "indicators-file-input":
      uiState.indicatorsSelectedFile = event.target.files?.[0] || null;
      uiState.indicatorsApiExperimentError = "";
      uploadIndicatorsFile(event.target.files?.[0]);
      break;
    case "trainees-filter-department":
      uiState.traineesFilters.department = event.target.value;
      renderTraineesDirectoryTable();
      break;
    case "trainees-filter-status":
      uiState.traineesFilters.status = event.target.value;
      renderTraineesDirectoryTable();
      break;
    case "trainees-filter-remaining":
      uiState.traineesFilters.remaining = event.target.value;
      renderTraineesDirectoryTable();
      break;
    case "report-filter-period":
      uiState.reportFilters.period = event.target.value;
      renderCurrentView();
      break;
    case "report-filter-department":
      uiState.reportFilters.department = event.target.value;
      renderCurrentView();
      break;
    case "report-filter-status":
      uiState.reportFilters.status = event.target.value;
      renderCurrentView();
      break;
    default:
      break;
  }
}

function handlePageContentKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const interactiveCard = event.target.closest(".card--interactive");

  if (!interactiveCard) {
    return;
  }

  event.preventDefault();

  updateCardSelection(interactiveCard.dataset.cardGroup, Number(interactiveCard.dataset.cardIndex));
}

function exportCurrentReportAsCsv() {
  const reportRows = filterReportTrainees();
  const headerRow = ["الاسم", "الإدارة", "المشرف", "تاريخ البداية", "تاريخ النهاية", "الحالة"];
  const dataRows = reportRows.map((trainee) => [
    trainee.name,
    trainee.department,
    trainee.supervisor,
    formatDate(trainee.startDate),
    formatDate(trainee.endDate),
    trainee.status,
  ]);

  const csvContent = [headerRow, ...dataRows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff", csvContent], { type: "text/csv;charset=utf-8;" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = "training-report.csv";
  link.click();

  URL.revokeObjectURL(downloadUrl);
}

function slugifyIndicatorFilename(value) {
  return String(value || "indicators")
    .normalize("NFKC")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "indicators";
}

function exportIndicatorsPowerBiPackage() {
  const powerBiPackage = uiState.indicatorsAnalysis?.powerBi;

  if (!powerBiPackage?.tables) {
    uiState.indicatorsUploadError = "لا توجد حزمة Power BI جاهزة للتصدير.";
    uiState.indicatorsUploadState = "error";
    renderCurrentView();
    return;
  }

  const filenameBase = slugifyIndicatorFilename(uiState.indicatorsAnalysis?.meta?.filename);
  const blob = new Blob([JSON.stringify(powerBiPackage, null, 2)], {
    type: "application/json;charset=utf-8;",
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = `${filenameBase}-powerbi-package.json`;
  link.click();

  URL.revokeObjectURL(downloadUrl);
}

function focusTraineeBasicInfo() {
  const basicInfoSection = document.getElementById("trainee-basic-info");

  if (basicInfoSection) {
    basicInfoSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function updateSelectedTraineeStatus() {
  const trainee = getSelectedTrainee();
  const nextStatus = getNextMockStatus(trainee.status);

  uiState.traineeDrafts[trainee.id] = {
    ...uiState.traineeDrafts[trainee.id],
    status: nextStatus,
  };

  renderCurrentView();
}

function addMockTraineeNote() {
  const trainee = getSelectedTrainee();
  const addition = `تمت مراجعة الملف بتاريخ ${formatCurrentDate()} وإضافة ملاحظة متابعة داخلية.`;
  const currentNotes = uiState.traineeDrafts[trainee.id]?.notes || trainee.notes;

  uiState.traineeDrafts[trainee.id] = {
    ...uiState.traineeDrafts[trainee.id],
    notes: `${currentNotes} ${addition}`.trim(),
  };

  renderCurrentView();
}

function toggleGeneralSetting(settingKey) {
  uiState.settings[settingKey] = !uiState.settings[settingKey];
  safeWriteStorage(STORAGE_KEYS.settings, JSON.stringify(uiState.settings));
  renderCurrentDate();
  renderCurrentView();
}

function handleSidebarFooterClick(event) {
  const actionTarget = event.target.closest("[data-sidebar-action]");

  if (!actionTarget) {
    return;
  }

  switch (actionTarget.dataset.sidebarAction) {
    case "toggle-theme":
      toggleTheme();
      break;
    case "navigate":
      navigateTo(actionTarget.dataset.sidebarView);
      break;
    case "logout":
      logout();
      break;
    default:
      break;
  }
}

function handleNotificationAction(actionTarget) {
  uiState.notificationsOpen = false;
  renderNotificationCenter();

  switch (actionTarget.dataset.notificationAction) {
    case "open-alerts":
      navigateTo("alerts");
      break;
    case "open-item":
      navigateTo("alerts", {
        alertGroup: actionTarget.dataset.alertGroup,
        alertTraineeId: Number(actionTarget.dataset.traineeId),
      });
      break;
    case "close":
      break;
    default:
      break;
  }
}

function handleTopbarUtilityClick(event) {
  const notificationToggle = getClosestElement(event.target, "#notifications-toggle");

  if (notificationToggle) {
    uiState.notificationsOpen = !uiState.notificationsOpen;
    renderNotificationCenter();
    return;
  }

  const notificationAction = getClosestElement(event.target, "[data-notification-action]");

  if (notificationAction) {
    handleNotificationAction(notificationAction);
  }
}

function handleDocumentClick(event) {
  if (!uiState.notificationsOpen) {
    return;
  }

  const notificationShell = document.getElementById("notification-shell");
  const notificationPanel = document.getElementById("notifications-panel");
  const notificationToggle = document.getElementById("notifications-toggle");

  if (
    notificationShell &&
    notificationPanel &&
    notificationToggle &&
    !notificationPanel.contains(event.target) &&
    !notificationToggle.contains(event.target)
  ) {
    uiState.notificationsOpen = false;
    renderNotificationCenter();
  }
}

function bindLayoutControls() {
  if (appControlsBound) {
    return;
  }

  const topbar = document.querySelector(".topbar");
  const sidebarNav = document.querySelector(".sidebar__nav");
  const pageContent = document.getElementById("page-content");

  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("sidebar-toggle").addEventListener("click", toggleSidebar);
  document.getElementById("search-input").addEventListener("input", handleTopbarSearchInput);

  if (topbar) {
    topbar.addEventListener("click", handleTopbarUtilityClick);
  }

  document.addEventListener("click", handleDocumentClick);

  sidebarNav?.addEventListener("click", (event) => {
    const navLink = getClosestElement(event.target, ".nav-link");

    if (!navLink) {
      return;
    }

    event.preventDefault();
    navigateTo(navLink.dataset.view);
  });

  document.getElementById("sidebar-footer").addEventListener("click", handleSidebarFooterClick);

  if (pageContent) {
    pageContent.addEventListener("click", handlePageContentClick);
    pageContent.addEventListener("input", handlePageContentInput);
    pageContent.addEventListener("change", handlePageContentChange);
    pageContent.addEventListener("keydown", handlePageContentKeydown);
  }

  appControlsBound = true;
}

function initializePreferences() {
  const savedTheme = safeReadStorage(STORAGE_KEYS.theme, "dark");
  const savedSidebarState = safeReadStorage(STORAGE_KEYS.sidebar, "expanded");
  const savedSettings = safeReadJsonStorage(STORAGE_KEYS.settings, uiState.settings);

  uiState.settings = {
    ...uiState.settings,
    ...savedSettings,
  };

  setTheme(savedTheme === "light" ? "light" : "dark");
  setSidebarState(savedSidebarState === "collapsed" ? "collapsed" : "expanded");
}

function showBootstrapError(message) {
  renderAuthState();
  const feedback = document.getElementById("login-feedback");
  const submitButton = document.getElementById("login-submit");

  if (feedback) {
    feedback.textContent = message;
    feedback.dataset.state = "error";
  }

  if (submitButton) {
    submitButton.disabled = true;
  }
}

async function initializeApp() {
  initializePreferences();
  bindLayoutControls();

  const introPromise = playInitialIntro();

  try {
    await loadBootstrapData();
  } catch (error) {
    await introPromise;
    showBootstrapError(error.message || "تعذر تحميل بيانات النظام من الخادم.");
    return;
  }

  initializeAuth();
  await introPromise;
}

initializeApp();
