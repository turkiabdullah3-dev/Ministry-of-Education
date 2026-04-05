const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const { authUser, trainees, getPublicAuthUser } = require("./data");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 5500);
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_ANALYZER_OUTPUT_BYTES = 8 * 1024 * 1024;
const ANALYZER_TIMEOUT_MS = 45_000;
const ALLOWED_ANALYZER_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
const ANALYSIS_API_URL = process.env.ANALYSIS_API_URL || "http://127.0.0.1:8001/analyze";
const AUTH_PEPPER = process.env.AUTH_PEPPER || "moe-auth-pepper-v1";
const AUTH_SCRYPT_OPTIONS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const AUTH_KEY_LENGTH = 64;
const ROUTE_SECURITY_POLICY = Object.freeze({
  "/api/login": { windowMs: 60_000, limit: 6, banMs: 10 * 60_000 },
  "/api/indicators/analyze": { windowMs: 90_000, limit: 10, banMs: 4 * 60_000 },
});
const requestGateState = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const INDICATOR_TONES = ["cyan", "mint", "violet", "teal", "amber", "blue"];

function getSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
    ].join("; "),
  };
}

function sendResponse(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    ...getSecurityHeaders(),
    ...headers,
  });
  response.end(body);
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  sendResponse(response, statusCode, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
}

function sendText(response, statusCode, message, extraHeaders = {}) {
  sendResponse(response, statusCode, message, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
}

function sendEmpty(response, statusCode, extraHeaders = {}) {
  sendResponse(response, statusCode, "", {
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
}

function isSafeStaticMethod(method) {
  return method === "GET" || method === "HEAD";
}

function hasJsonContentType(request) {
  const contentType = String(request.headers["content-type"] || "");
  return /^application\/json(?:\s*;|$)/i.test(contentType);
}

function ensureJsonRequest(request) {
  if (!hasJsonContentType(request)) {
    throw new Error("نوع الطلب غير صالح. أرسل البيانات بصيغة JSON.");
  }
}

function normalizeTextInput(value) {
  return String(value || "").normalize("NFKC").trim();
}

function normalizeUsername(value) {
  return normalizeTextInput(value).toLowerCase();
}

function digestText(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function timingSafeEqualText(left, right) {
  return crypto.timingSafeEqual(digestText(left), digestText(right));
}

function timingSafeEqualHex(leftHex, rightHex) {
  const left = Buffer.from(String(leftHex || ""), "hex");
  const right = Buffer.from(String(rightHex || ""), "hex");

  if (!left.length || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function resolveJsonError(error, fallbackMessage) {
  const message = normalizeTextInput(error && error.message);
  return message || fallbackMessage;
}

function deriveClientFingerprint(request) {
  const forwardedFor = normalizeTextInput(String(request.headers["x-forwarded-for"] || ""));
  const remoteAddress = normalizeTextInput(request.socket && request.socket.remoteAddress);
  const userAgent = normalizeTextInput(String(request.headers["user-agent"] || ""));
  const source = [forwardedFor, remoteAddress, digestText(userAgent).toString("hex")].join("|");
  return digestText(source || "local-client").toString("hex");
}

function pruneExpiredGateEntries(now) {
  for (const [key, record] of requestGateState.entries()) {
    const isWindowExpired = now - record.windowStartedAt > record.windowMs;
    const isBanExpired = record.blockedUntil <= now;

    if (isWindowExpired && isBanExpired) {
      requestGateState.delete(key);
    }
  }
}

function getRouteGateRecord(gateKey, policy, now) {
  const existing = requestGateState.get(gateKey);

  if (!existing || now - existing.windowStartedAt > policy.windowMs) {
    const freshRecord = {
      attempts: 0,
      windowStartedAt: now,
      windowMs: policy.windowMs,
      blockedUntil: 0,
    };
    requestGateState.set(gateKey, freshRecord);
    return freshRecord;
  }

  return existing;
}

function enforceRoutePolicy(request, pathname) {
  const policy = ROUTE_SECURITY_POLICY[pathname];

  if (!policy) {
    return;
  }

  const now = Date.now();
  pruneExpiredGateEntries(now);
  const gateKey = `${pathname}:${deriveClientFingerprint(request)}`;
  const record = getRouteGateRecord(gateKey, policy, now);

  if (record.blockedUntil > now) {
    throw new Error("تم إيقاف الطلبات مؤقتًا بسبب كثرة المحاولات. أعد المحاولة بعد قليل.");
  }

  record.attempts += 1;

  if (record.attempts > policy.limit) {
    record.blockedUntil = now + policy.banMs;
    throw new Error("تم إيقاف الطلبات مؤقتًا بسبب كثرة المحاولات. أعد المحاولة بعد قليل.");
  }
}

function derivePasswordHash(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPassword = normalizeTextInput(password);
  const salt = `${normalizedUsername}|${AUTH_PEPPER}`;
  return crypto
    .scryptSync(normalizedPassword, salt, AUTH_KEY_LENGTH, AUTH_SCRYPT_OPTIONS)
    .toString("hex");
}

function buildLoginReceipt(username) {
  const nonce = crypto.randomBytes(12).toString("hex");
  const issuedAt = new Date().toISOString();
  const signature = crypto
    .createHmac("sha256", `${AUTH_PEPPER}|receipt`)
    .update(`${normalizeUsername(username)}|${issuedAt}|${nonce}`)
    .digest("hex");

  return {
    nonce,
    issuedAt,
    signature,
  };
}

function normalizeUploadName(filename) {
  const normalized = path.basename(normalizeTextInput(filename));

  if (!normalized) {
    throw new Error("اسم الملف غير صالح.");
  }

  if (normalized.length > 180 || /[<>:"/\\|?*\x00-\x1f]/.test(normalized)) {
    throw new Error("اسم الملف يحتوي على رموز غير مسموحة.");
  }

  return normalized;
}

function normalizeBase64Payload(fileBase64) {
  const normalized = String(fileBase64 || "").replace(/\s+/g, "");

  if (!normalized) {
    throw new Error("تعذر قراءة الملف المرفوع.");
  }

  const base64Pattern =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  if (!base64Pattern.test(normalized)) {
    throw new Error("تنسيق الملف المرفوع غير صالح.");
  }

  return normalized;
}

function looksLikeCsvBuffer(buffer) {
  if (!buffer.length) {
    return false;
  }

  const hasUtf16Bom =
    (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff);

  if (hasUtf16Bom) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let printable = 0;
  let zeroBytes = 0;

  for (const byte of sample) {
    if (byte === 0) {
      zeroBytes += 1;
      continue;
    }

    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160) {
      printable += 1;
    }
  }

  const printableRatio = printable / sample.length;
  const zeroRatio = zeroBytes / sample.length;
  return printableRatio >= 0.72 || (zeroRatio <= 0.35 && printableRatio >= 0.45);
}

function detectFileSignature(fileBuffer) {
  if (fileBuffer.length >= 4) {
    const isZipContainer =
      fileBuffer[0] === 0x50 &&
      fileBuffer[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(fileBuffer[2]) &&
      [0x04, 0x06, 0x08].includes(fileBuffer[3]);

    if (isZipContainer) {
      return ".xlsx";
    }
  }

  if (
    fileBuffer.length >= 8 &&
    fileBuffer[0] === 0xd0 &&
    fileBuffer[1] === 0xcf &&
    fileBuffer[2] === 0x11 &&
    fileBuffer[3] === 0xe0 &&
    fileBuffer[4] === 0xa1 &&
    fileBuffer[5] === 0xb1 &&
    fileBuffer[6] === 0x1a &&
    fileBuffer[7] === 0xe1
  ) {
    return ".xls";
  }

  if (looksLikeCsvBuffer(fileBuffer)) {
    return ".csv";
  }

  return null;
}

function validateUploadedFile(filename, fileBase64) {
  const safeFilename = normalizeUploadName(filename);
  const extension = path.extname(safeFilename).toLowerCase();

  if (!ALLOWED_ANALYZER_EXTENSIONS.has(extension)) {
    throw new Error("نوع الملف غير مدعوم. ارفع ملف Excel أو CSV.");
  }

  const normalizedBase64 = normalizeBase64Payload(fileBase64);
  const fileBuffer = Buffer.from(normalizedBase64, "base64");

  if (!fileBuffer.length) {
    throw new Error("تعذر قراءة الملف المرفوع.");
  }

  if (fileBuffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("حجم الملف كبير جدًا. الحد الأقصى 12MB.");
  }

  const detectedExtension = detectFileSignature(fileBuffer);

  if (!detectedExtension) {
    throw new Error("تعذر التحقق من نوع الملف المرفوع.");
  }

  if (extension !== detectedExtension) {
    throw new Error("امتداد الملف لا يطابق محتواه الفعلي.");
  }

  return {
    safeFilename,
    extension,
    fileBuffer,
  };
}

function collectRequestBody(request) {
  ensureJsonRequest(request);

  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new Error("حجم الطلب كبير جدًا.");
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      callback(value);
    };

    request.on("data", (chunk) => {
      totalBytes += chunk.length;

      if (totalBytes > MAX_JSON_BODY_BYTES) {
        settle(reject, new Error("حجم الطلب كبير جدًا."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (!chunks.length) {
        settle(resolve, {});
        return;
      }

      try {
        const rawBody = Buffer.concat(chunks, totalBytes).toString("utf8");
        settle(resolve, JSON.parse(rawBody));
      } catch {
        settle(reject, new Error("هيئة JSON غير صالحة."));
      }
    });

    request.on("aborted", () => settle(reject, new Error("تم إلغاء الطلب قبل اكتماله.")));
    request.on("error", (error) => settle(reject, error));
  });
}

function safeNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeIndicatorTone(value, fallback = "cyan") {
  return INDICATOR_TONES.includes(value) ? value : fallback;
}

function deriveProcessingMode(rowCount) {
  const count = safeNumber(rowCount, 0);
  if (count >= 120_000) {
    return "heavy";
  }
  if (count >= 30_000) {
    return "elevated";
  }
  return "full";
}

function averageCompleteness(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) {
    return null;
  }

  const completenessValues = profiles
    .map((profile) => clamp((1 - safeNumber(profile.null_ratio, 1)) * 100, 0, 100))
    .filter((value) => Number.isFinite(value));

  if (!completenessValues.length) {
    return null;
  }

  const total = completenessValues.reduce((sum, value) => sum + value, 0);
  return roundTo(total / completenessValues.length, 1);
}

function roundTo(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(safeNumber(value, 0) * factor) / factor;
}

function buildMultipartUploadBody(filename, fileBuffer, extension) {
  const boundary = `----analysis-api-${crypto.randomUUID()}`;
  const mimeType =
    MIME_TYPES[extension] ||
    (extension === ".csv"
      ? "text/csv"
      : extension === ".xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/vnd.ms-excel");

  const headBuffer = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    "utf8",
  );
  const tailBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    boundary,
    body: Buffer.concat([headBuffer, fileBuffer, tailBuffer]),
  };
}

function requestAnalysisApi(filename, extension, fileBuffer) {
  const targetUrl = new URL(ANALYSIS_API_URL);
  const transport = targetUrl.protocol === "https:" ? https : http;
  const { boundary, body } = buildMultipartUploadBody(filename, fileBuffer, extension);

  return new Promise((resolve, reject) => {
    const apiRequest = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
          Accept: "application/json",
        },
        timeout: ANALYZER_TIMEOUT_MS,
      },
      (apiResponse) => {
        const chunks = [];
        let totalBytes = 0;

        apiResponse.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_ANALYZER_OUTPUT_BYTES) {
            apiResponse.destroy(new Error("نتيجة خدمة التحليل تجاوزت الحجم المسموح."));
            return;
          }
          chunks.push(chunk);
        });

        apiResponse.on("end", () => {
          const rawBody = Buffer.concat(chunks, totalBytes).toString("utf8");
          let payload = null;

          if (rawBody) {
            try {
              payload = JSON.parse(rawBody);
            } catch {
              reject(new Error("استجابة خدمة التحليل ليست JSON صالحًا."));
              return;
            }
          }

          if ((apiResponse.statusCode || 500) >= 400) {
            const detail = normalizeTextInput(payload && (payload.detail || payload.message));
            reject(new Error(detail || "تعذر معالجة الملف عبر خدمة التحليل."));
            return;
          }

          resolve(payload || {});
        });

        apiResponse.on("error", reject);
      },
    );

    apiRequest.on("timeout", () => {
      apiRequest.destroy(new Error("انتهت مهلة خدمة التحليل."));
    });
    apiRequest.on("error", (error) => {
      reject(new Error(resolveJsonError(error, "تعذر الوصول إلى خدمة التحليل.")));
    });

    apiRequest.end(body);
  });
}

function groupSchemaCandidates(schemaCandidates) {
  const grouped = new Map();
  for (const candidate of Array.isArray(schemaCandidates) ? schemaCandidates : []) {
    const role = String(candidate && candidate.role ? candidate.role : "");
    if (!role) {
      continue;
    }

    if (!grouped.has(role)) {
      grouped.set(role, []);
    }

    grouped.get(role).push(candidate);
  }

  return grouped;
}

function getTopSchemaCandidate(schemaCandidates, role) {
  const candidates = (Array.isArray(schemaCandidates) ? schemaCandidates : []).filter(
    (candidate) => candidate && candidate.role === role,
  );

  if (!candidates.length) {
    return null;
  }

  return candidates.reduce((best, current) =>
    safeNumber(current.confidence, 0) > safeNumber(best.confidence, 0) ? current : best,
  );
}

function buildLegacySchema(schemaCandidates) {
  const mapped = {};
  for (const role of ["identifier", "category", "metric", "status", "date", "plan", "entity", "text"]) {
    const topCandidate = getTopSchemaCandidate(schemaCandidates, role);
    mapped[role] = topCandidate ? topCandidate.column_name : null;
  }
  return mapped;
}

function mapDashboardCard(card, index) {
  const confidence = clamp(safeNumber(card && card.confidence, 0) * 100, 0, 100);
  return {
    title: String((card && card.title) || `مؤشر ${index + 1}`),
    actual: safeNumber(card && card.value, 0),
    actualDisplay: String((card && card.value) ?? "--"),
    referenceLabel: "التفصيل",
    referenceValue: String((card && card.subtitle) || "--"),
    progress: confidence,
    progressDisplay: `${Math.round(confidence)}%`,
    tone: normalizeIndicatorTone(card && card.tone, INDICATOR_TONES[index % INDICATOR_TONES.length]),
    description: `ثقة القراءة ${Math.round(confidence)}%.`,
  };
}

function buildLegacyCards(rawAnalysis) {
  const sourceCards = Array.isArray(rawAnalysis?.dashboard?.cards) ? rawAnalysis.dashboard.cards : [];
  const cards = sourceCards.map(mapDashboardCard);
  const qualityScore = safeNumber(rawAnalysis?.validation?.quality_score, 0);
  const confidenceScore = clamp(safeNumber(rawAnalysis?.validation?.confidence, 0) * 100, 0, 100);

  if (!cards.length) {
    cards.push(
      {
        title: "جودة الملف",
        actual: qualityScore,
        actualDisplay: `${Math.round(qualityScore)}%`,
        referenceLabel: "المستوى",
        referenceValue: rawAnalysis?.validation?.ready ? "جاهز" : "يحتاج مراجعة",
        progress: qualityScore,
        progressDisplay: `${Math.round(qualityScore)}%`,
        tone: "cyan",
        description: "مستوى الجودة العام المبني على الفحص الحالي.",
      },
      {
        title: "ثقة القراءة",
        actual: confidenceScore,
        actualDisplay: `${Math.round(confidenceScore)}%`,
        referenceLabel: "الاعتماد",
        referenceValue: confidenceScore >= 55 ? "مقبول" : "منخفض",
        progress: confidenceScore,
        progressDisplay: `${Math.round(confidenceScore)}%`,
        tone: "blue",
        description: "الثقة العامة في الربط الدلالي والقراءة الحالية.",
      },
    );
  }

  return cards.slice(0, 4);
}

function mapSeriesToLinePoints(series) {
  return (Array.isArray(series) ? series : []).map((item) => ({
    label: String(item.label ?? item.name ?? item.period ?? "--"),
    primary: safeNumber(item.value, 0),
    secondary: item.share == null ? null : safeNumber(item.share, 0),
  }));
}

function mapSeriesToDistributionItems(series) {
  return (Array.isArray(series) ? series : []).map((item, index) => ({
    label: String(item.label ?? item.name ?? "--"),
    value: safeNumber(item.value, 0),
    share: item.share == null ? 0 : safeNumber(item.share, 0),
    color: "#72e8ff",
    tone: INDICATOR_TONES[index % INDICATOR_TONES.length],
  }));
}

function mapSeriesToRankingItems(series) {
  return (Array.isArray(series) ? series : []).map((item, index) => ({
    label: String(item.label ?? item.name ?? "--"),
    value: safeNumber(item.value, 0),
    share: item.share == null ? 0 : safeNumber(item.share, 0),
    color: ["#72e8ff", "#66f2d6", "#7fb5ff", "#58d6ff", "#8ce6ff"][index % 5],
    tone: INDICATOR_TONES[index % INDICATOR_TONES.length],
  }));
}

function buildFieldQualityPanel(profiles) {
  const items = (Array.isArray(profiles) ? profiles : []).slice(0, 8).map((profile, index) => ({
    label: String(profile.name || `حقل ${index + 1}`),
    value: clamp((1 - safeNumber(profile.null_ratio, 1)) * 100, 0, 100),
    color: ["#72e8ff", "#66f2d6", "#7fb5ff", "#58d6ff", "#8ce6ff"][index % 5],
  }));

  return {
    title: "اكتمال الحقول",
    subtitle: "نسبة امتلاء الحقول المقروءة من الملف.",
    items,
  };
}

function buildLegacyDashboard(rawAnalysis) {
  const charts = Array.isArray(rawAnalysis?.dashboard?.charts) ? rawAnalysis.dashboard.charts : [];
  const lineCharts = charts.filter((chart) => chart && chart.chart_type === "line");
  const barChart = charts.find((chart) => chart && chart.chart_type === "bar");
  const distributionChart = charts.find((chart) => chart && chart.chart_type === "distribution");
  const comparisonChart = charts.find((chart) => chart && chart.chart_type === "comparison");

  const trend = lineCharts[0]
    ? {
        title: lineCharts[0].title,
        subtitle: lineCharts[0].subtitle,
        points: mapSeriesToLinePoints(lineCharts[0].series),
        secondaryLabel: null,
      }
    : { title: "اتجاه القراءة", subtitle: "لا تتوفر بيانات كافية للرسم.", points: [], secondaryLabel: null };

  const averageChart = lineCharts[1]
    ? {
        title: lineCharts[1].title,
        subtitle: lineCharts[1].subtitle,
        points: mapSeriesToLinePoints(lineCharts[1].series),
        secondaryLabel: null,
      }
    : trend;

  const peakChart = barChart
    ? {
        title: barChart.title,
        subtitle: barChart.subtitle,
        points: mapSeriesToLinePoints(barChart.series),
      }
    : { title: "القمم", subtitle: "لا توجد بيانات كافية.", points: [] };

  const distributionItems = distributionChart ? mapSeriesToDistributionItems(distributionChart.series) : [];
  const distributionTotal = distributionItems.reduce((sum, item) => sum + safeNumber(item.value, 0), 0);
  const distribution = distributionChart
    ? {
        title: distributionChart.title,
        subtitle: distributionChart.subtitle,
        items: distributionItems,
        total: distributionTotal,
      }
    : { title: "التوزيع", subtitle: "لا يوجد توزيع واضح بعد.", items: [], total: 0 };

  const comparison = comparisonChart
    ? {
        title: comparisonChart.title,
        subtitle: comparisonChart.subtitle,
        points: mapSeriesToLinePoints(comparisonChart.series),
        primaryLabel: "القيمة الأولى",
        secondaryLabel: "القيمة الثانية",
      }
    : {
        title: "المقارنة",
        subtitle: "لا توجد قراءة مقارنة جاهزة.",
        points: [],
        primaryLabel: "القيمة الأولى",
        secondaryLabel: "القيمة الثانية",
      };

  const rankingItems = distributionItems.length
    ? mapSeriesToRankingItems(distributionItems)
    : barChart
      ? mapSeriesToRankingItems(barChart.series)
      : [];
  const ranking = rankingItems.length
    ? {
        title: "أعلى العناصر",
        subtitle: "أكثر العناصر حضورًا في القراءة الحالية.",
        items: rankingItems.slice(0, 5),
      }
    : { title: "أعلى العناصر", subtitle: "لا توجد بيانات كافية.", items: [] };

  const radar = rankingItems.length
    ? {
        title: "بصمة المؤشرات",
        subtitle: "توزيع نسبي لأبرز العناصر المقروءة.",
        items: rankingItems.slice(0, 5).map((item) => ({
          label: item.label,
          share: item.share || 0,
          value: item.value,
        })),
      }
    : { title: "بصمة المؤشرات", subtitle: "لا توجد بيانات كافية.", items: [] };

  const qualityScore = safeNumber(rawAnalysis?.validation?.quality_score, 0);
  const confidenceScore = clamp(safeNumber(rawAnalysis?.validation?.confidence, 0) * 100, 0, 100);
  const ringMetric = {
    title: "ثقة التحليل",
    subtitle: "قراءة مركبة من الجودة والثقة العامة الحالية.",
    value: roundTo((qualityScore * 0.55) + (confidenceScore * 0.45), 1),
    display: `${Math.round((qualityScore * 0.55) + (confidenceScore * 0.45))}%`,
  };

  return {
    cards: buildLegacyCards(rawAnalysis),
    trend,
    ringMetric,
    peakChart,
    distribution,
    comparison,
    radar,
    ranking,
    averageChart,
    fieldQuality: buildFieldQualityPanel(rawAnalysis?.profile),
  };
}

function buildLegacyAssistant(rawAnalysis, legacyDashboard) {
  const assistant = rawAnalysis?.assistant || {};
  const confidenceNotice = assistant.confidence_notice;
  const findings = []
    .concat(
      (Array.isArray(assistant.key_findings) ? assistant.key_findings : []).map((detail, index) => ({
        title: `ملاحظة ${index + 1}`,
        detail: String(detail || ""),
        tone: normalizeIndicatorTone(INDICATOR_TONES[index % INDICATOR_TONES.length]),
      })),
    )
    .filter((item) => item.detail);

  if (confidenceNotice) {
    findings.push({
      title: "تنبيه الثقة",
      detail: String(confidenceNotice),
      tone: "amber",
    });
  }

  const focus = [
    {
      label: "الجودة",
      value: `${Math.round(safeNumber(rawAnalysis?.validation?.quality_score, 0))}%`,
      detail: "الدرجة الحالية المبنية على الفحص والتحقق.",
    },
    {
      label: "الثقة",
      value: `${Math.round(clamp(safeNumber(rawAnalysis?.validation?.confidence, 0) * 100, 0, 100))}%`,
      detail: "مستوى الثقة العام في البنية المقروءة.",
    },
  ];

  if (legacyDashboard?.distribution?.items?.length) {
    focus.push({
      label: "الأبرز",
      value: String(legacyDashboard.distribution.items[0].label || "--"),
      detail: `${Math.round(safeNumber(legacyDashboard.distribution.items[0].share, 0))}% من التوزيع الحالي.`,
    });
  }

  return {
    headline: String(assistant.headline || "تم تجهيز قراءة داخلية للملف."),
    summary: String(assistant.summary || ""),
    focus: focus.slice(0, 3),
    findings: findings.slice(0, 4),
    actions: Array.isArray(assistant.next_steps) ? assistant.next_steps.slice(0, 4) : [],
  };
}

function buildLegacyPowerBi(rawAnalysis) {
  return {
    tables: {
      Summary: [
        {
          filename: rawAnalysis?.meta?.filename || null,
          row_count: rawAnalysis?.meta?.row_count ?? rawAnalysis?.meta?.row_count_raw ?? null,
          column_count: rawAnalysis?.meta?.column_count ?? null,
          quality_score: rawAnalysis?.validation?.quality_score ?? null,
          confidence: rawAnalysis?.validation?.confidence ?? null,
        },
      ],
      Profile: Array.isArray(rawAnalysis?.profile) ? rawAnalysis.profile : [],
      SchemaCandidates: Array.isArray(rawAnalysis?.schema_candidates) ? rawAnalysis.schema_candidates : [],
      Warnings: (Array.isArray(rawAnalysis?.validation?.warnings) ? rawAnalysis.validation.warnings : []).map(
        (warning) => ({ warning }),
      ),
    },
  };
}

function mapFastApiAnalysisToLegacy(rawAnalysis) {
  const schemaCandidates = Array.isArray(rawAnalysis?.schema_candidates) ? rawAnalysis.schema_candidates : [];
  const groupedCandidates = groupSchemaCandidates(schemaCandidates);
  const completenessRate = averageCompleteness(rawAnalysis?.profile);
  const rowCount = safeNumber(rawAnalysis?.meta?.row_count, safeNumber(rawAnalysis?.meta?.row_count_raw, 0));
  const legacyDashboard = buildLegacyDashboard(rawAnalysis);
  const qualityScore = roundTo(rawAnalysis?.validation?.quality_score, 2);
  const confidence = roundTo(rawAnalysis?.validation?.confidence, 4);
  const needsReview =
    !rawAnalysis?.validation?.ready ||
    confidence < 0.67 ||
    (Array.isArray(rawAnalysis?.validation?.warnings) && rawAnalysis.validation.warnings.length > 0);

  return {
    meta: {
      filename: rawAnalysis?.meta?.filename || null,
      sheetName: Array.isArray(rawAnalysis?.meta?.sheet_names) ? rawAnalysis.meta.sheet_names[0] || null : null,
      rowCount,
      columnCount: safeNumber(rawAnalysis?.meta?.column_count, Array.isArray(rawAnalysis?.meta?.column_names_raw) ? rawAnalysis.meta.column_names_raw.length : 0),
      headerRow: null,
      sheetScore: null,
      selectionScore: schemaCandidates.length
        ? roundTo(
            (schemaCandidates.slice(0, 6).reduce((sum, candidate) => sum + safeNumber(candidate.confidence, 0), 0) /
              Math.min(schemaCandidates.length, 6)) *
              100,
            1,
          )
        : null,
    },
    schema: buildLegacySchema(schemaCandidates),
    validation: {
      qualityScore,
      completenessRate,
      ready: Boolean(rawAnalysis?.validation?.ready),
      needsReview,
      warnings: Array.isArray(rawAnalysis?.validation?.warnings) ? rawAnalysis.validation.warnings : [],
      errors: Array.isArray(rawAnalysis?.validation?.errors) ? rawAnalysis.validation.errors : [],
      detectedColumns: Object.values(buildLegacySchema(schemaCandidates)).filter(Boolean),
      columnConfidence: Object.fromEntries(
        Array.from(groupedCandidates.entries()).map(([role, candidates]) => [
          role,
          roundTo(safeNumber(candidates[0]?.confidence, 0) * 100, 1),
        ]),
      ),
      schemaCandidates,
      preflight: {
        score: qualityScore,
        processingMode: deriveProcessingMode(rowCount),
      },
      confidence,
    },
    dashboard: legacyDashboard,
    assistant: buildLegacyAssistant(rawAnalysis, legacyDashboard),
    powerBi: buildLegacyPowerBi(rawAnalysis),
  };
}

async function runIndicatorsAnalyzer(filename, fileBase64) {
  const { safeFilename, extension, fileBuffer } = validateUploadedFile(filename, fileBase64);

  try {
    const rawAnalysis = await requestAnalysisApi(safeFilename, extension, fileBuffer);
    return mapFastApiAnalysisToLegacy(rawAnalysis);
  } catch (error) {
    throw new Error(resolveJsonError(error, "تعذر تحليل ملف المؤشرات."));
  }
}

function isAuthorizedLogin(username, password) {
  const expectedUsername = normalizeUsername(authUser.username);
  const expectedPasswordHash = normalizeTextInput(authUser.passwordHash);
  const suppliedPasswordHash = derivePasswordHash(username, password);
  return (
    timingSafeEqualText(username, expectedUsername) &&
    timingSafeEqualHex(suppliedPasswordHash, expectedPasswordHash)
  );
}

async function handleApiRequest(request, response, pathname) {
  if (request.method === "OPTIONS") {
    sendEmpty(response, 204, {
      Allow: "GET, POST, HEAD, OPTIONS",
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/bootstrap") {
    sendJson(response, 200, {
      authUser: getPublicAuthUser(),
      trainees,
    });
    return true;
  }

  if (pathname === "/api/login" && request.method !== "POST") {
    sendJson(
      response,
      405,
      {
        message: "الطريقة غير مدعومة لهذا المسار.",
      },
      {
        Allow: "POST, OPTIONS",
      },
    );
    return true;
  }

  if (request.method === "POST" && pathname === "/api/login") {
    try {
      enforceRoutePolicy(request, pathname);
      const body = await collectRequestBody(request);
      const username = normalizeUsername(body.username);
      const password = normalizeTextInput(body.password);

      if (!username || !password) {
        sendJson(response, 400, {
          message: "أدخل رمز المستخدم وكلمة المرور للمتابعة.",
        });
        return true;
      }

      if (!isAuthorizedLogin(username, password)) {
        sendJson(response, 401, {
          message: "بيانات الدخول غير صحيحة. تأكد من رمز المستخدم وكلمة المرور.",
        });
        return true;
      }

      sendJson(response, 200, {
        user: getPublicAuthUser(),
        receipt: buildLoginReceipt(username),
      });
      return true;
    } catch (error) {
      const message = resolveJsonError(error, "تعذر قراءة بيانات الطلب.");
      const statusCode = message.includes("كثرة المحاولات") ? 429 : 400;
      sendJson(response, statusCode, {
        message,
      });
      return true;
    }
  }

  if (pathname === "/api/indicators/analyze" && request.method !== "POST") {
    sendJson(
      response,
      405,
      {
        message: "الطريقة غير مدعومة لهذا المسار.",
      },
      {
        Allow: "POST, OPTIONS",
      },
    );
    return true;
  }

  if (request.method === "POST" && pathname === "/api/indicators/analyze") {
    try {
      enforceRoutePolicy(request, pathname);
      const body = await collectRequestBody(request);
      const analysis = await runIndicatorsAnalyzer(body.filename, body.fileBase64);

      sendJson(response, 200, {
        analysis,
      });
      return true;
    } catch (error) {
      const message = resolveJsonError(error, "تعذر تحليل ملف المؤشرات.");
      const statusCode = message.includes("كثرة المحاولات") ? 429 : 400;
      sendJson(response, statusCode, {
        message,
      });
      return true;
    }
  }

  return false;
}

function resolveFilePath(pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const requestedPath = path.normalize(path.join(FRONTEND_DIR, normalizedPath));

  if (!requestedPath.startsWith(FRONTEND_DIR)) {
    return null;
  }

  return requestedPath;
}

async function handleStaticRequest(request, response, pathname) {
  const filePath = resolveFilePath(pathname);

  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const stats = await fs.promises.stat(filePath);
    const targetPath = stats.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const extension = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const fileBuffer = await fs.promises.readFile(targetPath);

    response.writeHead(200, {
      ...getSecurityHeaders(),
      "Content-Type": contentType,
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(fileBuffer);
  } catch {
    sendText(response, 404, "Not Found");
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (!isSafeStaticMethod(request.method) && request.method !== "POST" && request.method !== "OPTIONS") {
    sendText(response, 405, "Method Not Allowed", {
      Allow: "GET, HEAD, POST, OPTIONS",
    });
    return;
  }

  if (await handleApiRequest(request, response, requestUrl.pathname)) {
    return;
  }

  if (!isSafeStaticMethod(request.method)) {
    sendText(response, 405, "Method Not Allowed", {
      Allow: "GET, HEAD, OPTIONS",
    });
    return;
  }

  await handleStaticRequest(request, response, requestUrl.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
