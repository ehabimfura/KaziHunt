// ===== Hero background slideshow =====
const heroSlides = document.querySelectorAll('.hero-bg-slide');
let activeSlide = 0;

setInterval(() => {
  heroSlides[activeSlide].classList.remove('active');
  activeSlide = (activeSlide + 1) % heroSlides.length;
  heroSlides[activeSlide].classList.add('active');
}, 10000);

// ===== State =====
let currentMode = 'local'; // 'local' or 'remote'
let currentPage = 1;
let totalResults = 0;
let currentJobs = [];
let favorites = JSON.parse(localStorage.getItem('kazihunt_favs') || '[]');

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const localToggle = $('#localToggle');
const remoteToggle = $('#remoteToggle');
const localFields = $('#localFields');
const remoteFields = $('#remoteFields');
const searchForm = $('#searchForm');
const keywordInput = $('#keywordInput');
const countrySelect = $('#countrySelect');
const cityInput = $('#cityInput');
const categorySelect = $('#categorySelect');
const sortSelect = $('#sortSelect');
const jobTypeSelect = $('#jobTypeSelect');
const jobTypeGroup = $('#jobTypeGroup');
const salaryGroup = $('#salaryGroup');
const salaryMin = $('#salaryMin');
const salaryMax = $('#salaryMax');
const filterInput = $('#filterInput');
const jobList = $('#jobList');
const loader = $('#loader');
const errorMsg = $('#errorMsg');
const noResults = $('#noResults');
const statusBar = $('#statusBar');
const resultCount = $('#resultCount');
const pagination = $('#pagination');
const prevBtn = $('#prevBtn');
const nextBtn = $('#nextBtn');
const pageInfo = $('#pageInfo');
const favoritesBtn = $('#favoritesBtn');
const favModal = $('#favModal');
const closeFavModal = $('#closeFavModal');
const favList = $('#favList');
const favCount = $('#favCount');

// salary insights DOM elements
const salaryInsights = $('#salaryInsights');
const insightsTitle = $('#insightsTitle');
const statAvg = $('#statAvg');
const statRange = $('#statRange');
const statTotal = $('#statTotal');
const insightsError = $('#insightsError');
const insightsBtn = $('#insightsBtn');
const insightsCloseBtn = $('#insightsCloseBtn');

// chart instances — kept so we can destroy them before drawing new ones
let histogramChartInstance = null;
let historyChartInstance = null;

// store the last fetched insights data so the button can draw charts on demand
let pendingInsights = null;

// show insights panel when button is clicked
insightsBtn.addEventListener('click', () => {
  if (!pendingInsights) return;
  renderInsightsPanel(pendingInsights);
  salaryInsights.classList.remove('hidden');
  salaryInsights.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// close button hides the panel
insightsCloseBtn.addEventListener('click', () => {
  salaryInsights.classList.add('hidden');
});

// ===== Mode Toggle =====
localToggle.addEventListener('click', () => switchMode('local'));
remoteToggle.addEventListener('click', () => switchMode('remote'));

function switchMode(mode) {
  currentMode = mode;
  currentPage = 1;
  currentJobs = [];

  localToggle.classList.toggle('active', mode === 'local');
  remoteToggle.classList.toggle('active', mode === 'remote');
  localFields.classList.toggle('hidden', mode !== 'local');
  remoteFields.classList.toggle('hidden', mode !== 'remote');

  // salary range is available in both modes
  salaryGroup.classList.remove('hidden');

  // update job type options for remote mode
  if (mode === 'remote') {
    jobTypeSelect.innerHTML = `
      <option value="">All Types</option>
      <option value="full_time">Full-time</option>
      <option value="part_time">Part-time</option>
      <option value="contract">Contract</option>
      <option value="freelance">Freelance</option>
      <option value="internship">Internship</option>
    `;
  } else {
    jobTypeSelect.innerHTML = `
      <option value="">All Types</option>
      <option value="full_time">Full-time</option>
      <option value="part_time">Part-time</option>
      <option value="contract">Contract</option>
      <option value="permanent">Permanent</option>
    `;
  }

  hideSalaryInsights();
  clearResults();
}

// ===== Load remote categories on start =====
async function loadRemoteCategories() {
  try {
    const res = await fetch('/api/categories/remote');
    const data = await res.json();
    categorySelect.innerHTML = '<option value="">All Categories</option>';
    data.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat.slug;
      opt.textContent = cat.name;
      categorySelect.appendChild(opt);
    });
  } catch (e) {
    // categories will just show "All Categories"
  }
}
loadRemoteCategories();

// ===== Search =====
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  currentPage = 1;
  fetchJobs();
});

async function fetchJobs() {
  const keyword = keywordInput.value.trim();
  if (!keyword) {
    showError('Please enter a job title or keyword.');
    return;
  }

  showLoader();

  try {
    let data;

    if (currentMode === 'local') {
      const country = countrySelect.value;
      const city = cityInput.value.trim();

      // build the jobs URL
      const jobParams = new URLSearchParams({
        keyword,
        country,
        page: currentPage,
        sort: sortSelect.value,
      });
      if (city) jobParams.set('city', city);
      if (salaryMin.value) jobParams.set('salary_min', salaryMin.value);
      if (salaryMax.value) jobParams.set('salary_max', salaryMax.value);
      if (jobTypeSelect.value) jobParams.set('job_type', jobTypeSelect.value);

      // build salary insight URLs (histogram + history)
      const insightParams = new URLSearchParams({ keyword, country });
      if (city) insightParams.set('city', city);

      // fire all three calls at once
      const [jobsRes, histRes, historyRes] = await Promise.all([
        fetch(`/api/jobs/local?${jobParams}`),
        fetch(`/api/salary/histogram?${insightParams}`).catch(() => null),
        fetch(`/api/salary/history?${insightParams}`).catch(() => null),
      ]);

      data = await jobsRes.json();

      if (!jobsRes.ok) {
        showError(data.error || 'Something went wrong.');
        return;
      }

      // parse insight responses — don't crash if they fail
      const histData = histRes ? await histRes.json().catch(() => ({})) : {};
      const historyData = historyRes ? await historyRes.json().catch(() => ({})) : {};

      showSalaryInsights(keyword, country, city, histData.histogram, historyData.month, data.total);

    } else {
      const params = new URLSearchParams({ keyword });
      if (categorySelect.value) params.set('category', categorySelect.value);

      const res = await fetch(`/api/jobs/remote?${params}`);
      data = await res.json();

      if (!res.ok) {
        showError(data.error || 'Something went wrong.');
        return;
      }
    }

    totalResults = data.total || 0;
    currentJobs = data.jobs || [];

    renderJobs(currentJobs);

  } catch (err) {
    showError('Network error. Please check your connection and try again.');
  }
}

// ===== Render Jobs =====
function renderJobs(jobs) {
  hideAll();

  // filter results locally
  const filterText = filterInput.value.toLowerCase().trim();
  let filtered = jobs;
  if (filterText) {
    filtered = jobs.filter(j =>
      j.title.toLowerCase().includes(filterText) ||
      j.company.toLowerCase().includes(filterText) ||
      (j.location && j.location.toLowerCase().includes(filterText))
    );
  }

  // sort for remote jobs (local sorting is API-side)
  if (currentMode === 'remote') {
    const sortVal = sortSelect.value;
    if (sortVal === 'date') {
      filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    } else if (sortVal === 'salary') {
      filtered.sort((a, b) => {
        const sa = parseSalary(a.salary || a.salary_max);
        const sb = parseSalary(b.salary || b.salary_max);
        return sb - sa;
      });
    }

    // filter by job type for remote
    const typeVal = jobTypeSelect.value;
    if (typeVal) {
      filtered = filtered.filter(j =>
        j.job_type && j.job_type.toLowerCase().replace(/[\s-]/g, '_').includes(typeVal)
      );
    }

    // filter by salary range for remote (client-side)
    const remoteMinVal = parseFloat(salaryMin.value);
    const remoteMaxVal = parseFloat(salaryMax.value);
    if (!isNaN(remoteMinVal) && remoteMinVal > 0) {
      filtered = filtered.filter(j => parseSalary(j.salary) >= remoteMinVal);
    }
    if (!isNaN(remoteMaxVal) && remoteMaxVal > 0) {
      filtered = filtered.filter(j => {
        const s = parseSalary(j.salary);
        return s === 0 || s <= remoteMaxVal;
      });
    }
  }

  if (filtered.length === 0) {
    noResults.classList.remove('hidden');
    pagination.classList.add('hidden');
    statusBar.classList.add('hidden');
    return;
  }

  // for remote, do client-side pagination
  let displayJobs = filtered;
  const perPage = 20;

  if (currentMode === 'remote') {
    const start = (currentPage - 1) * perPage;
    displayJobs = filtered.slice(start, start + perPage);
    totalResults = filtered.length;
  }

  statusBar.classList.remove('hidden');
  resultCount.textContent = `${totalResults} job${totalResults !== 1 ? 's' : ''} found`;

  jobList.innerHTML = '';
  displayJobs.forEach(job => {
    jobList.appendChild(createJobCard(job));
  });

  // pagination
  const totalPages = Math.ceil(totalResults / perPage);
  if (totalPages > 1) {
    pagination.classList.remove('hidden');
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
  } else {
    pagination.classList.add('hidden');
  }
}

function createJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';

  const isFav = favorites.some(f => f.id === job.id);
  const salary = formatSalary(job);
  const date = timeAgo(job.date);
  const badge = getTypeBadge(job);
  const logoHtml = job.company_logo
    ? `<img src="${escapeHtml(job.company_logo)}" alt="" class="job-logo">`
    : `<div class="job-logo-placeholder">${escapeHtml(job.company.charAt(0).toUpperCase())}</div>`;

  card.innerHTML = `
    <div class="job-card-header">
      ${logoHtml}
      <div class="job-info">
        <div class="job-title">${escapeHtml(job.title)}</div>
        <div class="job-company">${escapeHtml(job.company)}</div>
        <div class="job-meta">
          <span class="job-meta-item">${escapeHtml(job.location)}</span>
          ${salary ? `<span class="job-meta-item job-salary">${salary}</span>` : ''}
          ${date ? `<span class="job-meta-item">${date}</span>` : ''}
          ${badge}
        </div>
      </div>
      <div class="job-actions">
        <button class="job-fav-btn ${isFav ? 'saved' : ''}" title="Save job">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
    </div>
  `;

  // expand details on click
  let expanded = false;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.job-fav-btn') || e.target.closest('.job-apply-btn')) return;

    if (!expanded) {
      const details = document.createElement('div');
      details.className = 'job-details';

      const desc = job.description
        ? stripHtml(job.description).slice(0, 500) + (job.description.length > 500 ? '...' : '')
        : 'No description available.';

      details.innerHTML = `
        <p>${escapeHtml(desc)}</p>
        <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener" class="job-apply-btn">Apply Now</a>
      `;
      card.appendChild(details);
      expanded = true;
    } else {
      const details = card.querySelector('.job-details');
      if (details) details.remove();
      expanded = false;
    }
  });

  // favorite button
  const favBtn = card.querySelector('.job-fav-btn');
  favBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFavorite(job);
    favBtn.classList.toggle('saved');
    const svg = favBtn.querySelector('svg');
    svg.setAttribute('fill', favBtn.classList.contains('saved') ? 'currentColor' : 'none');
  });

  return card;
}

// ===== Pagination =====
prevBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    if (currentMode === 'local') {
      fetchJobs();
    } else {
      renderJobs(currentJobs);
    }
    window.scrollTo({ top: 300, behavior: 'smooth' });
  }
});

nextBtn.addEventListener('click', () => {
  currentPage++;
  if (currentMode === 'local') {
    fetchJobs();
  } else {
    renderJobs(currentJobs);
  }
  window.scrollTo({ top: 300, behavior: 'smooth' });
});

// salary range inputs — validate, then re-fetch or re-render
[salaryMin, salaryMax].forEach(input => {
  input.addEventListener('input', () => {
    // clamp negatives to 0
    if (parseFloat(input.value) < 0) input.value = 0;

    // validate min <= max
    const minVal = parseFloat(salaryMin.value);
    const maxVal = parseFloat(salaryMax.value);
    if (!isNaN(minVal) && !isNaN(maxVal) && minVal > maxVal) {
      salaryMin.style.borderColor = 'var(--error)';
      salaryMax.style.borderColor = 'var(--error)';
      salaryMin.title = 'Min cannot be greater than Max';
      salaryMax.title = 'Max cannot be less than Min';
      return; // don't search with invalid range
    } else {
      salaryMin.style.borderColor = '';
      salaryMax.style.borderColor = '';
      salaryMin.title = '';
      salaryMax.title = '';
    }

    if (currentMode === 'local') {
      currentPage = 1;
      fetchJobs();
    } else if (currentJobs.length > 0) {
      currentPage = 1;
      renderJobs(currentJobs);
    }
  });
});

// ===== Filter & Sort (client-side) =====
filterInput.addEventListener('input', () => {
  if (currentJobs.length > 0) {
    currentPage = 1;
    renderJobs(currentJobs);
  }
});

sortSelect.addEventListener('change', () => {
  if (currentMode === 'local') {
    currentPage = 1;
    fetchJobs();
  } else if (currentJobs.length > 0) {
    currentPage = 1;
    renderJobs(currentJobs);
  }
});

jobTypeSelect.addEventListener('change', () => {
  if (currentMode === 'local') {
    currentPage = 1;
    fetchJobs();
  } else if (currentJobs.length > 0) {
    currentPage = 1;
    renderJobs(currentJobs);
  }
});

// ===== Favorites =====
function toggleFavorite(job) {
  const idx = favorites.findIndex(f => f.id === job.id);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push({
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.url,
    });
  }
  localStorage.setItem('kazihunt_favs', JSON.stringify(favorites));
  updateFavCount();
}

function updateFavCount() {
  favCount.textContent = favorites.length;
}
updateFavCount();

favoritesBtn.addEventListener('click', () => {
  renderFavorites();
  favModal.classList.remove('hidden');
});

closeFavModal.addEventListener('click', () => {
  favModal.classList.add('hidden');
});

favModal.addEventListener('click', (e) => {
  if (e.target === favModal) favModal.classList.add('hidden');
});

function renderFavorites() {
  if (favorites.length === 0) {
    favList.innerHTML = '<p class="fav-empty">No saved jobs yet.</p>';
    return;
  }

  favList.innerHTML = '';
  favorites.forEach(fav => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    item.innerHTML = `
      <div class="fav-item-info">
        <h3><a href="${escapeHtml(fav.url)}" target="_blank" rel="noopener">${escapeHtml(fav.title)}</a></h3>
        <p>${escapeHtml(fav.company)}</p>
      </div>
      <button class="fav-remove-btn">Remove</button>
    `;
    item.querySelector('.fav-remove-btn').addEventListener('click', () => {
      favorites = favorites.filter(f => f.id !== fav.id);
      localStorage.setItem('kazihunt_favs', JSON.stringify(favorites));
      updateFavCount();
      renderFavorites();
    });
    favList.appendChild(item);
  });
}

// ===== Helpers =====
function showLoader() {
  hideAll();
  loader.classList.remove('hidden');
}

function showError(msg) {
  hideAll();
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideAll() {
  loader.classList.add('hidden');
  errorMsg.classList.add('hidden');
  noResults.classList.add('hidden');
  jobList.innerHTML = '';
  statusBar.classList.add('hidden');
}

function clearResults() {
  hideAll();
  destroyCharts();
  hideSalaryInsights();
  pagination.classList.add('hidden');
}

function formatSalary(job) {
  if (job.salary) return job.salary;
  if (job.salary_min && job.salary_max) {
    return `${formatNum(job.salary_min)} - ${formatNum(job.salary_max)}`;
  }
  if (job.salary_min) return `From ${formatNum(job.salary_min)}`;
  if (job.salary_max) return `Up to ${formatNum(job.salary_max)}`;
  return '';
}

// map each Adzuna country code to its currency
const COUNTRY_CURRENCY = {
  gb: 'GBP', us: 'USD', au: 'AUD', at: 'EUR', br: 'BRL',
  ca: 'CAD', de: 'EUR', fr: 'EUR', in: 'INR', it: 'EUR',
  nl: 'EUR', nz: 'NZD', pl: 'PLN', sg: 'SGD', za: 'ZAR'
};

function formatNum(n) {
  if (!n) return '';
  const currency = currentMode === 'local'
    ? (COUNTRY_CURRENCY[countrySelect.value] || 'USD')
    : 'USD';
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

function parseSalary(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  // handle strings like "$120k", "£60,000 - £80,000", "€50K", "100000"
  const str = String(val).toLowerCase().replace(/,/g, '');
  const matches = [...str.matchAll(/([\d]+\.?\d*)\s*([km]?)/g)];
  if (!matches.length) return 0;
  const nums = matches
    .map(m => {
      let n = parseFloat(m[1]);
      if (m[2] === 'k') n *= 1000;
      if (m[2] === 'm') n *= 1000000;
      return n;
    })
    .filter(n => n >= 1000); // ignore tiny numbers like "2" from "2 years"
  if (!nums.length) return 0;
  return Math.max(...nums);
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function getTypeBadge(job) {
  const type = (job.contract_time || job.contract_type || job.job_type || '').toLowerCase();
  if (!type) return '';

  let cls = '';
  let label = '';

  if (type.includes('full')) { cls = 'fulltime'; label = 'Full-time'; }
  else if (type.includes('part')) { cls = 'parttime'; label = 'Part-time'; }
  else if (type.includes('contract')) { cls = 'contract'; label = 'Contract'; }
  else if (type.includes('permanent')) { cls = 'permanent'; label = 'Permanent'; }
  else if (type.includes('freelance')) { cls = 'freelance'; label = 'Freelance'; }
  else if (type.includes('intern')) { cls = 'parttime'; label = 'Internship'; }
  else { label = type.charAt(0).toUpperCase() + type.slice(1); cls = 'contract'; }

  return `<span class="job-badge job-badge--${cls}">${label}</span>`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function stripHtml(str) {
  const div = document.createElement('div');
  div.innerHTML = str;
  return div.textContent || '';
}

// ===== Salary Insights =====

// country code → currency symbol for chart labels
const COUNTRY_SYMBOL = {
  gb: '£', us: '$', au: 'A$', at: '€', br: 'R$',
  ca: 'CA$', de: '€', fr: '€', in: '₹', it: '€',
  nl: '€', nz: 'NZ$', pl: 'zł', sg: 'S$', za: 'R'
};

function showSalaryInsights(keyword, country, city, histogram, monthData, totalJobs) {
  const hasHistogram = histogram && Object.keys(histogram).length > 0;
  const hasHistory = monthData && Object.keys(monthData).length > 0;

  if (!hasHistogram && !hasHistory) {
    // no data available — hide button, keep panel hidden
    pendingInsights = null;
    insightsBtn.classList.add('hidden');
    return;
  }

  // store data for when the user clicks the button
  pendingInsights = { keyword, country, city, histogram, monthData, totalJobs };

  // show the "Salary Trends" button in the filters bar
  insightsBtn.classList.remove('hidden');

  // hide the panel itself until button is clicked
  salaryInsights.classList.add('hidden');
}

function renderInsightsPanel(data) {
  const { keyword, country, city, histogram, monthData, totalJobs } = data;
  destroyCharts();

  const symbol = COUNTRY_SYMBOL[country] || '$';
  const locationText = city ? `${city}, ${country.toUpperCase()}` : country.toUpperCase();

  insightsTitle.textContent = `Salary Insights for "${keyword}" in ${locationText}`;
  statTotal.textContent = totalJobs.toLocaleString();

  const hasHistogram = histogram && Object.keys(histogram).length > 0;
  const hasHistory = monthData && Object.keys(monthData).length > 0;

  if (!hasHistogram && !hasHistory) {
    insightsError.classList.remove('hidden');
    statAvg.textContent = '—';
    statRange.textContent = '—';
    return;
  }

  insightsError.classList.add('hidden');

  if (hasHistogram) {
    const entries = Object.entries(histogram)
      .map(([k, v]) => ({ salary: parseInt(k), count: parseInt(v) }))
      .sort((a, b) => a.salary - b.salary);

    let totalCount = 0;
    let weightedSum = 0;
    let peakCount = 0;
    let peakSalary = 0;

    entries.forEach(e => {
      totalCount += e.count;
      weightedSum += e.salary * e.count;
      if (e.count > peakCount) {
        peakCount = e.count;
        peakSalary = e.salary;
      }
    });

    const avg = totalCount > 0 ? Math.round(weightedSum / totalCount) : 0;
    statAvg.textContent = avg > 0 ? `${symbol}${avg.toLocaleString()}` : '—';
    statRange.textContent = peakSalary > 0
      ? `${symbol}${(peakSalary / 1000).toFixed(0)}k – ${symbol}${((peakSalary + 10000) / 1000).toFixed(0)}k`
      : '—';

    drawHistogram(entries, symbol);
  } else {
    statAvg.textContent = '—';
    statRange.textContent = '—';
  }

  if (hasHistory) {
    const sortedMonths = Object.keys(monthData).sort();
    const historyEntries = sortedMonths.map(m => ({ month: m, avg: monthData[m] }));
    drawHistory(historyEntries, symbol);
  }
}

function hideSalaryInsights() {
  pendingInsights = null;
  insightsBtn.classList.add('hidden');
  salaryInsights.classList.add('hidden');
}

function destroyCharts() {
  if (histogramChartInstance) {
    histogramChartInstance.destroy();
    histogramChartInstance = null;
  }
  if (historyChartInstance) {
    historyChartInstance.destroy();
    historyChartInstance = null;
  }
}

function drawHistogram(entries, symbol) {
  const labels = entries.map(e => {
    const low = e.salary / 1000;
    const high = (e.salary + 10) / 1000;
    return `${symbol}${low.toFixed(0)}k–${high.toFixed(0)}k`;
  });
  const counts = entries.map(e => e.count);

  const ctx = document.getElementById('histogramChart').getContext('2d');
  histogramChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Jobs',
        data: counts,
        backgroundColor: 'rgba(26, 115, 232, 0.75)',
        borderColor: '#1a73e8',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Salary Distribution', font: { size: 13, weight: '600' } },
        legend: { display: false },
      },
      scales: {
        x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
        y: { beginAtZero: true, title: { display: true, text: 'Jobs' } }
      }
    }
  });
}

function drawHistory(entries, symbol) {
  // format "2025-03" → "Mar 2025"
  const labels = entries.map(e => {
    const [year, month] = e.month.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en', { month: 'short', year: 'numeric' });
  });
  const values = entries.map(e => Math.round(e.avg));

  const ctx = document.getElementById('historyChart').getContext('2d');
  historyChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Avg Salary',
        data: values,
        borderColor: '#1a73e8',
        backgroundColor: 'rgba(26, 115, 232, 0.1)',
        pointBackgroundColor: '#1a73e8',
        pointRadius: 4,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: 'Salary Trend', font: { size: 13, weight: '600' } },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${symbol}${ctx.parsed.y.toLocaleString()}`
          }
        }
      },
      scales: {
        x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
        y: {
          beginAtZero: false,
          ticks: {
            callback: (val) => `${symbol}${(val / 1000).toFixed(0)}k`
          }
        }
      }
    }
  });
}
