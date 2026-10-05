(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    rawRows: [],
    rows: [],
    fileName: "",
    charts: {},
    columns: {},
    headers: []
  };

  const aliases = {
    timestamp: ["timestamp", "time", "datetime", "date_time", "date"],
    latency: ["latency_ms", "latency", "latencyms", "response_time_ms", "response_time"],
    cpu: ["edge_cpu_load_%", "edge_cpu_load", "cpu_load_%", "cpu_load", "cpu", "edge_cpu"],
    task: ["task_type", "task", "workload", "tasktype"],
    target: ["target", "routing_target", "destination", "location", "decision"],
    smoke: ["smoke_detected", "smoke", "alert", "alert_detected", "emergency", "risk_event"]
  };

  const normalizeKey = (value) =>
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[%()]/g, m => m === "%" ? "_%" : "")
      .replace(/[^a-z0-9_%]+/g, "_")
      .replace(/^_+|_+$/g, "");

  function findColumn(headers, names) {
    const normalized = new Map(headers.map(h => [normalizeKey(h), h]));
    for (const name of names) {
      if (normalized.has(name)) return normalized.get(name);
    }
    return null;
  }

  function detectColumns(headers) {
    const detected = {};
    for (const [key, names] of Object.entries(aliases)) {
      detected[key] = findColumn(headers, names);
    }
    return detected;
  }

  function numberValue(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v === null || v === undefined || v === "") return null;
    const cleaned = String(v).replace(/,/g, "").replace(/%/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function booleanValue(v) {
    if (typeof v === "boolean") return v;
    const s = String(v ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "y", "smoke", "alert", "detected", "on"].includes(s)) return true;
    if (["false", "0", "no", "n", "none", "clear", "off"].includes(s)) return false;
    return null;
  }

  function dateValue(v) {
    if (v === null || v === undefined || v === "") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function taskLabel(v) {
    const s = String(v ?? "").trim();
    if (!s) return "Unknown";
    if (/^-?\d+(\.\d+)?$/.test(s)) return `Task ${Number(s)}`;
    return s;
  }

  function cleanRows(rawRows) {
    const c = state.columns;
    return rawRows.map((r, index) => ({
      __index: index + 1,
      __raw: r,
      timestamp: c.timestamp ? dateValue(r[c.timestamp]) : null,
      latency: c.latency ? numberValue(r[c.latency]) : null,
      cpu: c.cpu ? numberValue(r[c.cpu]) : null,
      task: c.task ? taskLabel(r[c.task]) : "Unknown",
      target: c.target ? String(r[c.target] ?? "").trim() || "Unknown" : "Unknown",
      smoke: c.smoke ? booleanValue(r[c.smoke]) : null
    }));
  }

  function setStatus(message, type = "") {
    const box = $("statusBox");
    box.textContent = message;
    box.className = `status-box ${type}`.trim();
  }

  function parseFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus("Please choose a valid .csv file.", "error");
      return;
    }

    setStatus("Reading and analysing CSV…");

    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      complete: (result) => {
        if (result.errors?.length && !result.data?.length) {
          setStatus("CSV could not be parsed. Please check the file format.", "error");
          return;
        }

        const rows = result.data.filter(row =>
          Object.values(row).some(v => String(v ?? "").trim() !== "")
        );

        if (!rows.length) {
          setStatus("The CSV is empty.", "error");
          return;
        }

        state.fileName = file.name;
        state.headers = result.meta.fields || Object.keys(rows[0]);
        state.columns = detectColumns(state.headers);
        state.rawRows = rows;
        state.rows = cleanRows(rows);

        if (!state.columns.target && !state.columns.latency) {
          setStatus(
            "CSV loaded, but I could not detect Target or Latency columns. Check the detected schema below.",
            "error"
          );
        } else {
          setStatus(`Loaded ${rows.length.toLocaleString()} rows successfully.`, "success");
        }

        initialiseDashboard();
      },
      error: () => setStatus("There was a problem reading this CSV.", "error")
    });
  }

  function initialiseDashboard() {
    $("dashboard").classList.remove("hidden");
    $("uploadPanel").classList.add("hidden");
    $("exportBtn").disabled = false;
    $("resetBtn").disabled = false;

    $("fileMeta").textContent = `${state.fileName} • ${state.rawRows.length.toLocaleString()} records • ${state.headers.length} columns`;

    populateFilters();
    renderSchema();
    refreshDashboard();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function uniqueValues(key) {
    return [...new Set(state.rows.map(r => r[key]).filter(v => v !== null && v !== undefined && v !== ""))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  function populateSelect(select, values, allLabel) {
    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "__all__";
    all.textContent = allLabel;
    select.appendChild(all);

    values.forEach(v => {
      const option = document.createElement("option");
      option.value = String(v);
      option.textContent = String(v);
      select.appendChild(option);
    });
  }

  function populateFilters() {
    populateSelect($("targetFilter"), uniqueValues("target"), "All targets");
    populateSelect($("taskFilter"), uniqueValues("task"), "All tasks");
  }

  function filteredRows() {
    const target = $("targetFilter").value;
    const task = $("taskFilter").value;
    return state.rows.filter(r =>
      (target === "__all__" || r.target === target) &&
      (task === "__all__" || r.task === task)
    );
  }

  function groupBy(rows, key) {
    const map = new Map();
    rows.forEach(r => {
      const k = r[key] ?? "Unknown";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return map;
  }

  function avg(values) {
    const clean = values.filter(v => typeof v === "number" && Number.isFinite(v));
    return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
  }

  const fmt = (n, digits = 0) =>
    n === null || !Number.isFinite(n)
      ? "—"
      : n.toLocaleString(undefined, { maximumFractionDigits: digits });

  function getThemeColors() {
    return {
      blue: "#2f80ed",
      orange: "#f2994a",
      green: "#27ae60",
      red: "#eb5757",
      purple: "#9b51e0",
      teal: "#2d9cdb",
      gray: "#9aa6b2",
      text: "#59667a",
      grid: "rgba(116, 129, 148, 0.14)"
    };
  }

  function destroyChart(id) {
    if (state.charts[id]) {
      state.charts[id].destroy();
      delete state.charts[id];
    }
  }

  function baseChartOptions() {
    const colors = getThemeColors();
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "nearest" },
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, boxWidth: 8, color: colors.text, padding: 16 }
        },
        tooltip: {
          backgroundColor: "#172033",
          titleColor: "#fff",
          bodyColor: "#fff",
          padding: 11,
          cornerRadius: 10
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: colors.text, maxRotation: 35, minRotation: 0 }
        },
        y: {
          beginAtZero: true,
          grid: { color: colors.grid },
          ticks: { color: colors.text }
        }
      }
    };
  }

  function renderKPIs(rows) {
    $("kpiRecords").textContent = rows.length.toLocaleString();
    $("kpiRecordsSub").textContent = rows.length === state.rows.length ? "Uploaded rows" : "Rows after filters";

    const targetGroups = [...groupBy(rows, "target").entries()]
      .map(([name, rs]) => ({ name, count: rs.length }))
      .sort((a, b) => b.count - a.count);

    if (targetGroups.length) {
      const top = targetGroups[0];
      const share = rows.length ? (top.count / rows.length) * 100 : 0;
      $("kpiTargetShare").textContent = `${share.toFixed(1)}%`;
      $("kpiTargetShareSub").textContent = `${top.name}: ${top.count.toLocaleString()} records`;
    } else {
      $("kpiTargetShare").textContent = "—";
      $("kpiTargetShareSub").textContent = "No target data";
    }

    const latencyAvg = avg(rows.map(r => r.latency));
    $("kpiLatency").textContent = latencyAvg === null ? "—" : `${fmt(latencyAvg)} ms`;
    $("kpiLatencySub").textContent = "Across selected records";

    const knownSmoke = rows.filter(r => r.smoke !== null);
    const smokeCount = knownSmoke.filter(r => r.smoke === true).length;
    $("kpiSmoke").textContent = knownSmoke.length ? smokeCount.toLocaleString() : "—";
    $("kpiSmokeSub").textContent = knownSmoke.length
      ? `${((smokeCount / knownSmoke.length) * 100).toFixed(1)}% of known-status records`
      : "No alert column detected";
  }

  function renderRoutingChart(rows) {
    destroyChart("routing");
    const colors = getThemeColors();
    const data = [...groupBy(rows, "target").entries()]
      .map(([label, rs]) => ({ label, value: rs.length }))
      .sort((a, b) => b.value - a.value);

    state.charts.routing = new Chart($("routingChart"), {
      type: "doughnut",
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.value),
          backgroundColor: [colors.blue, colors.orange, colors.green, colors.purple, colors.red, colors.teal, colors.gray],
          borderColor: "#ffffff",
          borderWidth: 3,
          hoverOffset: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "66%",
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, boxWidth: 8, padding: 16 }
          }
        }
      }
    });
  }

  function renderTargetLatency(rows) {
    destroyChart("targetLatency");
    const colors = getThemeColors();
    const data = [...groupBy(rows, "target").entries()]
      .map(([label, rs]) => ({ label, value: avg(rs.map(r => r.latency)) }))
      .filter(d => d.value !== null)
      .sort((a, b) => a.value - b.value);

    state.charts.targetLatency = new Chart($("targetLatencyChart"), {
      type: "bar",
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          label: "Average latency (ms)",
          data: data.map(d => Number(d.value.toFixed(2))),
          backgroundColor: colors.blue,
          borderRadius: 8
        }]
      },
      options: baseChartOptions()
    });
  }

  function renderTaskLatency(rows) {
    destroyChart("taskLatency");
    const colors = getThemeColors();
    const data = [...groupBy(rows, "task").entries()]
      .map(([label, rs]) => ({ label, value: avg(rs.map(r => r.latency)) }))
      .filter(d => d.value !== null)
      .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));

    state.charts.taskLatency = new Chart($("taskLatencyChart"), {
      type: "bar",
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          label: "Average latency (ms)",
          data: data.map(d => Number(d.value.toFixed(2))),
          backgroundColor: colors.teal,
          borderRadius: 8
        }]
      },
      options: baseChartOptions()
    });
  }

  function renderSmokeRouting(rows) {
    destroyChart("smokeRouting");
    const colors = getThemeColors();
    const known = rows.filter(r => r.smoke !== null);
    const targets = uniqueFromRows(known, "target");

    const datasets = targets.map((target, idx) => ({
      label: target,
      data: [
        known.filter(r => r.smoke === false && r.target === target).length,
        known.filter(r => r.smoke === true && r.target === target).length
      ],
      backgroundColor: [colors.blue, colors.orange, colors.green, colors.purple, colors.red, colors.teal][idx % 6],
      borderRadius: 7
    }));

    state.charts.smokeRouting = new Chart($("smokeRoutingChart"), {
      type: "bar",
      data: { labels: ["No alert", "Alert detected"], datasets },
      options: {
        ...baseChartOptions(),
        scales: {
          x: { stacked: false, grid: { display: false } },
          y: { beginAtZero: true, grid: { color: colors.grid } }
        }
      }
    });
  }

  function uniqueFromRows(rows, key) {
    return [...new Set(rows.map(r => r[key]).filter(v => v !== null && v !== undefined && v !== ""))]
      .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  function renderTrend(rows) {
    destroyChart("trend");
    const colors = getThemeColors();
    const withDates = rows.filter(r => r.timestamp && r.latency !== null).sort((a, b) => a.timestamp - b.timestamp);

    let labels = [];
    let values = [];

    if (withDates.length) {
      const buckets = new Map();
      const desiredBuckets = Math.min(30, Math.max(8, Math.round(Math.sqrt(withDates.length))));
      const start = withDates[0].timestamp.getTime();
      const end = withDates[withDates.length - 1].timestamp.getTime();
      const span = Math.max(1, end - start);
      const bucketMs = Math.max(1, Math.ceil(span / desiredBuckets));

      withDates.forEach(r => {
        const bucket = Math.floor((r.timestamp.getTime() - start) / bucketMs);
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket).push(r);
      });

      [...buckets.entries()].forEach(([, rs]) => {
        const first = rs[0].timestamp;
        labels.push(first.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: span < 3 * 86400000 ? "2-digit" : undefined,
          minute: span < 86400000 ? "2-digit" : undefined
        }));
        values.push(Number(avg(rs.map(r => r.latency)).toFixed(2)));
      });
    } else {
      const valid = rows.filter(r => r.latency !== null);
      const maxPoints = 35;
      const chunk = Math.max(1, Math.ceil(valid.length / maxPoints));
      for (let i = 0; i < valid.length; i += chunk) {
        const rs = valid.slice(i, i + chunk);
        labels.push(`${i + 1}-${Math.min(i + chunk, valid.length)}`);
        values.push(Number(avg(rs.map(r => r.latency)).toFixed(2)));
      }
    }

    state.charts.trend = new Chart($("trendChart"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Average latency (ms)",
          data: values,
          borderColor: colors.blue,
          backgroundColor: "rgba(47,128,237,.10)",
          fill: true,
          tension: .28,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        ...baseChartOptions(),
        plugins: {
          ...baseChartOptions().plugins,
          legend: { display: false }
        }
      }
    });
  }

  function renderScatter(rows) {
    destroyChart("scatter");
    const colors = getThemeColors();
    const targetNames = uniqueFromRows(rows, "target");
    const palette = [colors.blue, colors.orange, colors.green, colors.purple, colors.red, colors.teal];

    const datasets = targetNames.map((target, idx) => ({
      label: target,
      data: rows
        .filter(r => r.target === target && r.cpu !== null && r.latency !== null)
        .slice(0, 1500)
        .map(r => ({ x: r.cpu, y: r.latency })),
      backgroundColor: palette[idx % palette.length],
      pointRadius: 4,
      pointHoverRadius: 6
    })).filter(ds => ds.data.length);

    state.charts.scatter = new Chart($("scatterChart"), {
      type: "scatter",
      data: { datasets },
      options: {
        ...baseChartOptions(),
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "CPU load (%)", color: colors.text },
            grid: { color: colors.grid },
            ticks: { color: colors.text }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Latency (ms)", color: colors.text },
            grid: { color: colors.grid },
            ticks: { color: colors.text }
          }
        }
      }
    });
  }

  function correlation(pairs) {
    if (pairs.length < 3) return null;
    const xs = pairs.map(p => p[0]);
    const ys = pairs.map(p => p[1]);
    const mx = avg(xs), my = avg(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < pairs.length; i++) {
      const a = xs[i] - mx;
      const b = ys[i] - my;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    const den = Math.sqrt(dx * dy);
    return den ? num / den : null;
  }

  function renderInsights(rows) {
    const insights = [];

    const targetStats = [...groupBy(rows, "target").entries()]
      .map(([name, rs]) => ({
        name,
        count: rs.length,
        avgLatency: avg(rs.map(r => r.latency))
      }))
      .sort((a, b) => b.count - a.count);

    if (targetStats.length) {
      const top = targetStats[0];
      insights.push(`${top.name} is the dominant routing destination, handling ${((top.count / rows.length) * 100).toFixed(1)}% of the selected records.`);
    }

    const withLatency = targetStats.filter(x => x.avgLatency !== null).sort((a, b) => a.avgLatency - b.avgLatency);
    if (withLatency.length >= 2) {
      const fast = withLatency[0];
      const slow = withLatency[withLatency.length - 1];
      const multiple = slow.avgLatency / Math.max(fast.avgLatency, 0.0001);
      insights.push(`${fast.name} has the lowest average latency at ${fmt(fast.avgLatency)} ms, while ${slow.name} averages ${fmt(slow.avgLatency)} ms (${multiple.toFixed(1)}× higher).`);
    }

    const taskStats = [...groupBy(rows, "task").entries()]
      .map(([name, rs]) => ({ name, avgLatency: avg(rs.map(r => r.latency)), count: rs.length }))
      .filter(x => x.avgLatency !== null)
      .sort((a, b) => a.avgLatency - b.avgLatency);

    if (taskStats.length) {
      insights.push(`${taskStats[0].name} is the fastest workload in this selection at ${fmt(taskStats[0].avgLatency)} ms average latency.`);
    }

    const knownSmoke = rows.filter(r => r.smoke !== null);
    const smokeRows = knownSmoke.filter(r => r.smoke === true);
    if (smokeRows.length) {
      const smokeTargets = [...groupBy(smokeRows, "target").entries()]
        .map(([name, rs]) => ({ name, count: rs.length }))
        .sort((a, b) => b.count - a.count);
      const top = smokeTargets[0];
      insights.push(`During alert conditions, ${top.name} handled ${((top.count / smokeRows.length) * 100).toFixed(1)}% of alert records (${top.count}/${smokeRows.length}).`);
    }

    const pairs = rows.filter(r => r.cpu !== null && r.latency !== null).map(r => [r.cpu, r.latency]);
    const corr = correlation(pairs);
    if (corr !== null) {
      const strength = Math.abs(corr) >= .7 ? "strong" : Math.abs(corr) >= .4 ? "moderate" : "weak";
      const direction = corr >= 0 ? "positive" : "negative";
      insights.push(`CPU load and latency show a ${strength} ${direction} relationship (correlation ${corr.toFixed(2)}).`);
    }

    if (!insights.length) insights.push("Not enough recognised numeric/categorical fields are available to generate strategic insights.");

    $("insightList").innerHTML = insights.map(i => `<li>${escapeHtml(i)}</li>`).join("");
  }

  function renderSchema() {
    const found = Object.entries(state.columns)
      .filter(([, value]) => value)
      .map(([role, column]) => `<span class="schema-chip">${escapeHtml(role)} → ${escapeHtml(column)}</span>`);

    const unmappedCount = state.headers.length - found.length;
    if (unmappedCount > 0) {
      found.push(`<span class="schema-chip">${unmappedCount} additional column${unmappedCount === 1 ? "" : "s"}</span>`);
    }

    $("schemaChips").innerHTML = found.join("") || `<span class="schema-chip">No known analytics columns detected</span>`;
  }

  function renderTable(rows) {
    const headers = state.headers.slice(0, 12);
    $("rowCountBadge").textContent = `${rows.length.toLocaleString()} rows`;

    $("tableHead").innerHTML = `<tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
    $("tableBody").innerHTML = rows.slice(0, 50).map(row => {
      return `<tr>${headers.map(h => `<td>${escapeHtml(String(row.__raw[h] ?? ""))}</td>`).join("")}</tr>`;
    }).join("");

    if (!rows.length) {
      $("tableBody").innerHTML = `<tr><td colspan="${Math.max(1, headers.length)}">No rows match the selected filters.</td></tr>`;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function refreshDashboard() {
    const rows = filteredRows();
    renderKPIs(rows);
    renderRoutingChart(rows);
    renderTargetLatency(rows);
    renderTaskLatency(rows);
    renderSmokeRouting(rows);
    renderTrend(rows);
    renderScatter(rows);
    renderInsights(rows);
    renderTable(rows);
  }

  async function exportDashboard() {
    const button = $("exportBtn");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Exporting…";

    try {
      const canvas = await html2canvas($("dashboard"), {
        backgroundColor: "#f4f7fb",
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true
      });

      const link = document.createElement("a");
      const base = state.fileName.replace(/\.csv$/i, "") || "dashboard";
      link.download = `${base}-business-intelligence-dashboard.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (err) {
      console.error(err);
      alert("Could not export the dashboard image.");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function resetDashboard() {
    Object.values(state.charts).forEach(chart => chart.destroy());
    state.charts = {};
    state.rawRows = [];
    state.rows = [];
    state.headers = [];
    state.columns = {};
    state.fileName = "";

    $("dashboard").classList.add("hidden");
    $("uploadPanel").classList.remove("hidden");
    $("fileInput").value = "";
    $("exportBtn").disabled = true;
    $("resetBtn").disabled = true;
    setStatus("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const fileInput = $("fileInput");
  const dropZone = $("dropZone");

  fileInput.addEventListener("change", (e) => parseFile(e.target.files?.[0]));

  ["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (e) => parseFile(e.dataTransfer.files?.[0]));
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  $("targetFilter").addEventListener("change", refreshDashboard);
  $("taskFilter").addEventListener("change", refreshDashboard);
  $("exportBtn").addEventListener("click", exportDashboard);
  $("resetBtn").addEventListener("click", resetDashboard);
})();
