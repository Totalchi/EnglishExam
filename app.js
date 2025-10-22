/* ====== CONFIG ====== */
const FILES = {
  QUESTIONS_JSON: 'questions.json' // or 'questions_large.json'
};

// CEFR scale mapping by percentage (rough heuristic)
const LEVEL_BANDS = [
  { level: 'A1', min: 0,   max: 29 },
  { level: 'A2', min: 30,  max: 44 },
  { level: 'B1', min: 45,  max: 59 },
  { level: 'B2', min: 60,  max: 74 },
  { level: 'C1', min: 75,  max: 89 },
  { level: 'C2', min: 90,  max: 100 }
];

// Topics map to precise “ripasso” prescriptions
const RIPASSO_LIBRARY = {
  "A1: family vocabulary in subject position": "Revise basic family nouns and subject pronouns (my/your/his/her). 10 quick sentences describing relatives.",
  "A1: 'be' + noun": "Short drills with 'be' (am/is/are) + noun/adjective. Focus on contractions and word order.",
  "A2: Present Simple 3rd person -s": "Conjugation grid; 20 sentences adding -s/-es; contrast with I/you forms.",
  "B1: Past Simple vs Present Perfect": "Signal words (yesterday/ago vs since/for/already). 15 contrast items + short timeline task.",
  "B2: Passive voice (past simple)": "Transform 20 active→passive sentences; include by-agent and time adverbials.",
  "C1: Mixed conditionals (3rd + 2nd)": "Build chains: past cause → present result. Write 10 mixed examples from prompts.",
  "C2: Inversion after negative adverbials": "Inversion starter set: Never/Rarely/Hardly/Only then/etc. Rewrite 12 sentences.",
  "A1: basic adjectives of weather": "Mini-picture prompts; choose an adjective; expand with 'It’s... today.'",
  "B1: adjectives of character": "Collocate adjectives with nouns (reliable colleague, trustworthy friend). Make 10 collocations.",
  "C1: academic verbs / nuance": "Verb families (mitigate/alleviate). Build paraphrases in context; 12 sentence rewrites.",
  "B1: dependent prepositions": "Gap-fill with prepositions (look for, fed up with). 25 items + error-correction.",
  "B1: fixed expressions": "Chunks list: 'fed up with', 'in charge of', 'on time'. Make mini-dialogues.",
  "B2: word formation (suffixes)": "Suffix tables: -tion/-ment/-ity. Convert base→noun in 30 items.",
  "C1: collocations": "Verb–noun banks (commit a crime, pose a threat). Write 10 original sentences.",
  "A2: specific information (times)": "Listening for times. Practise: opening hours, timetables; answer with numbers.",
  "B2: announcements — extracting key detail": "Noting delay durations/platforms. Do 10 short audios; write key figures.",
  "B1: identify main idea": "Skim strategies; topic sentence recognition. Summarise paragraphs in 1 line.",
  "C1: cause–effect inference": "Connectors: although/therefore/however. Infer unintended outcomes from short texts.",
  "B1: paragraphing and basic coherence": "PEE (Point–Evidence–Explanation). Write 2×140-word narratives with clear paragraphs.",
  "B2: range of tenses & linking devices": "Vary tenses; use linking (however, therefore). Rewrite to increase variety.",
  "C1: register control and cohesion": "Reduce repetition; use referencing devices. Edit for cohesive flow.",
  "C2: precision and nuance in argumentation": "Strengthen hedging and stance (arguably, ostensibly). Mini-essay polishing.",
  "B2: extracting requirement": "Scan texts to find constraints and requirements. Practise with notices & policies.",
  "B1: past perfect with 'by the time'": "Timeline drills contrasting Past Perfect and Past Simple."
};

/* ====== STATE ====== */
let DATA = null; // loaded questions.json
let currentSectionIdx = 0;
let answers = {}; // { questionId: value }
let chartRef = null;
let MISTAKES = []; // detailed mistake log

/* ====== HELPERS ====== */
const $ = (sel) => document.querySelector(sel);
const el = (tag, props={}, ...children) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k,v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.entries(v).forEach(([dk,dv]) => n.dataset[dk]=dv);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  children.forEach(c => n.append(c));
  return n;
};
const norm = (s) => (s||'').toString().trim().toLowerCase();

const firstOf = (arr) => Array.isArray(arr) ? arr[0] : arr;

/* Build a readable “correct answer” string for the log */
function correctAnswerText(item){
  if (item.type === 'cloze'){
    return (item.answers||[])
      .map(set => firstOf(set))
      .join(' | ');
  }
  if (item.answer_regex){
    return 'Matches pattern: ' + item.answer_regex.replace(/^\^|\$$/g,'');
  }
  if (Array.isArray(item.answer)){
    if (Array.isArray(item.answer[0])){ // nested (e.g., mixed cond.)
      return item.answer.map(set => firstOf(set)).join(' | ');
    }
    return item.answer.join(' / ');
  }
  return item.answer ?? '';
}

/* Compare user input with expected */
function checkAnswer(item, userVal) {
  if (item.type === 'cloze') {
    if (!Array.isArray(userVal)) return {correct:false};
    const blanks = item.answers || [];
    if (userVal.length !== blanks.length) return {correct:false};
    let correctCount = 0;
    userVal.forEach((v,i) => {
      const accs = blanks[i].map(norm);
      if (accs.includes(norm(v))) correctCount++;
    });
    return {correct: correctCount === blanks.length, partial: correctCount, total: blanks.length};
  }

  if (item.answer_regex) {
    const re = new RegExp(item.answer_regex, 'i');
    return {correct: re.test((userVal||'').toString().trim())};
  }
  const expected = item.answer;
  if (Array.isArray(expected)) {
    if (Array.isArray(expected[0])) {
      const parts = Array.isArray(userVal) ? userVal : (userVal||'').toString().split('|').map(s=>s.trim());
      if (parts.length !== expected.length) return {correct:false};
      let ok = true;
      for (let i=0;i<expected.length;i++){
        const set = expected[i].map(norm);
        if (!set.includes(norm(parts[i]))) ok = false;
      }
      return {correct: ok};
    }
    return {correct: expected.map(norm).includes(norm(userVal))};
  }
  if (typeof expected === 'string') {
    return {correct: norm(userVal) === norm(expected)};
  }
  return {correct:false};
}

/* Heuristic writing scorer */
function scoreWriting(text){
  const wc = (text||'').trim().split(/\s+/).filter(Boolean).length;
  const connectors = ['however','therefore','moreover','in addition','although','whereas','despite','furthermore','consequently','on the other hand'];
  const tenses = ['have ', 'had ', 'will ', 'would ', 'was ', 'were ', 'am ', 'is ', 'are '];
  const cHits = connectors.reduce((a,c)=> a + (text.toLowerCase().includes(c) ? 1 : 0), 0);
  const tHits = tenses.reduce((a,c)=> a + (text.toLowerCase().includes(c) ? 1 : 0), 0);
  let score = 0;
  if (wc >= 110) score += 2;
  if (wc >= 140) score += 1;
  if (cHits >= 2) score += 1;
  if (tHits >= 3) score += 1;
  if (/[.!?]\s+[A-Z]/.test(text)) score += 1;
  return Math.min(score, 6);
}
function writingLevelFromScore(s){
  if (s <= 2) return 'B1';
  if (s <= 4) return 'B2';
  if (s === 5) return 'C1';
  return 'C2';
}
function cefrFromPercent(pct){
  for (const band of LEVEL_BANDS){
    if (pct >= band.min && pct <= band.max) return band.level;
  }
  return 'A1';
}

/* ====== RENDERING ====== */
async function loadData(){
  const res = await fetch(FILES.QUESTIONS_JSON);
  DATA = await res.json();
}
function buildTabs(){
  const tabs = $('#sectionTabs');
  tabs.innerHTML = '';
  DATA.sections.forEach((s,idx)=>{
    const t = el('button', {class: 'tab' + (idx===currentSectionIdx?' active':''), onclick: ()=>{saveSectionAnswers(); currentSectionIdx=idx; renderSection(); buildTabs();}}, s.title);
    tabs.append(t);
  });
}
function renderSection(){
  const holder = $('#sectionContent');
  holder.innerHTML = '';
  const sec = DATA.sections[currentSectionIdx];

  sec.items.forEach(item=>{
    const q = el('div', {class:'question', id:`q_${item.id}`});
    q.append(el('h4', {}, `${sec.title} — ${item.skill} (${item.level_hint})`));
    if (item.type.startsWith('reading')) {
      q.append(el('div',{class:'reading'}, item.passage));
    }
    q.append(el('p', {}, item.prompt || item.question || ''));

    if (item.type === 'mcq' || item.type === 'reading_mcq') {
      const wrap = el('div',{class:'choices'});
      item.options.forEach(opt=>{
        const id = `${item.id}_${opt}`;
        const inp = el('input',{type:'radio',name:item.id,id});
        const lbl = el('label',{for:id,class:'choice'}, inp, el('span',{}, opt));
        wrap.append(lbl);
      });
      q.append(wrap);
    } else if (item.type === 'fill' || item.type === 'short' || item.type === 'reading_short'){
      const inp = el('input',{type:'text', id:`inp_${item.id}`, autocomplete:'off', placeholder:"Type your answer"});
      q.append(inp);
    } else if (item.type === 'cloze'){
      const row = el('div', {class:'choices'});
      for (let i=0;i<item.blanks;i++){
        const inp = el('input',{type:'text', id:`inp_${item.id}_${i}`, autocomplete:'off', placeholder:`Blank ${i+1}`});
        row.append(inp);
      }
      q.append(row);
    } else if (item.type === 'listening_tts'){
      const aRow = el('div',{class:'audioRow'});
      const play = el('button',{class:'btn', onclick:()=> speak(item.tts_text)}, '▶ Play');
      aRow.append(play, el('span',{class:'muted'}, 'Text-to-speech audio'));
      q.append(aRow);
      const inp = el('input',{type:'text', id:`inp_${item.id}`, autocomplete:'off', placeholder:"Your answer"});
      q.append(inp);
    } else if (item.type === 'writing'){
      const ta = el('textarea',{id:`inp_${item.id}`, placeholder:"Write your response here (120–180 words). No suggestions are shown."});
      q.append(ta);
      const counter = el('div',{class:'muted', id:`wc_${item.id}`}, 'Word count: 0');
      q.append(counter);
      ta.addEventListener('input',()=>{
        const wc = ta.value.trim().split(/\s+/).filter(Boolean).length;
        counter.textContent = `Word count: ${wc}`;
      });
    }
    holder.append(q);
  });
}
function saveSectionAnswers(){
  const sec = DATA.sections[currentSectionIdx];
  sec.items.forEach(item=>{
    if (item.type === 'mcq' || item.type === 'reading_mcq'){
      const checked = [...document.querySelectorAll(`#q_${item.id} input[type=radio]`)].find(r=>r.checked);
      answers[item.id] = checked ? checked.id.replace(`${item.id}_`,'') : null;
    } else if (item.type === 'fill' || item.type === 'short' || item.type === 'reading_short' || item.type === 'listening_tts'){
      const v = $(`#inp_${item.id}`)?.value ?? '';
      answers[item.id] = v;
    } else if (item.type === 'cloze'){
      const arr = [];
      for (let i=0;i<item.blanks;i++){
        arr.push($(`#inp_${item.id}_${i}`)?.value ?? '');
      }
      answers[item.id] = arr;
    } else if (item.type === 'writing'){
      answers[item.id] = $(`#inp_${item.id}`)?.value ?? '';
    }
  });
}

/* ====== LISTENING (TTS) ====== */
function speak(text){
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }catch(e){
    alert('Speech synthesis not available in this browser.');
  }
}

/* ====== SCORING + MISTAKE LOG ====== */
function scoreAll(){
  saveSectionAnswers();
  MISTAKES = []; // reset

  let totalAuto = 0, correctAuto = 0;
  const perSkill = {};
  const reviewHits = {}; // { tag: countWrong }

  DATA.sections.forEach(sec=>{
    sec.items.forEach(item=>{
      if (!perSkill[item.skill]) perSkill[item.skill] = {total:0, correct:0};
      if (item.type === 'writing'){
        const text = answers[item.id] || '';
        const s = scoreWriting(text);
        perSkill[item.skill].total += 6;
        perSkill[item.skill].correct += s;
        // pseudo-feedback as review tags for writing
        if (s <= 2) addReviewTags(item, ["B1: paragraphing and basic coherence"]);
        else if (s <= 4) addReviewTags(item, ["B2: range of tenses & linking devices"]);
        else if (s === 5) addReviewTags(item, ["C1: register control and cohesion"]);
        else addReviewTags(item, ["C2: precision and nuance in argumentation"]);
        return;
      }

      perSkill[item.skill].total += (item.type === 'cloze' ? item.answers.length : 1);
      totalAuto += (item.type === 'cloze' ? item.answers.length : 1);

      const userVal = answers[item.id];
      const result = checkAnswer(item, userVal);

      if (item.type === 'cloze'){
        perSkill[item.skill].correct += (result.partial || 0);
        correctAuto += (result.partial || 0);
        if (!result.correct){
          addReviewTags(item, item.review_tags);
          MISTAKES.push({
            section: sec.title,
            level: item.level_hint,
            prompt: item.prompt,
            your: Array.isArray(userVal) ? userVal.join(' | ') : (userVal ?? ''),
            correct: correctAnswerText(item)
          });
        }
      } else {
        if (result.correct){
          perSkill[item.skill].correct += 1;
          correctAuto += 1;
        } else {
          addReviewTags(item, item.review_tags);
          MISTAKES.push({
            section: sec.title,
            level: item.level_hint,
            prompt: item.prompt || item.question || '',
            your: Array.isArray(userVal) ? userVal.join(' | ') : (userVal ?? ''),
            correct: correctAnswerText(item)
          });
        }
      }
    });
  });

  function addReviewTags(item, tags){
    (tags||[]).forEach(t=>{
      reviewHits[t] = (reviewHits[t]||0) + 1;
    });
  }

  const skillPct = {};
  Object.entries(perSkill).forEach(([skill, obj])=>{
    const pct = obj.total ? Math.round((obj.correct/obj.total)*100) : 0;
    skillPct[skill] = {pct, total:obj.total, correct:obj.correct};
  });

  const primarySkills = ['Grammar','Use of English','Vocabulary','Reading','Listening'];
  let sum = 0, count = 0;
  primarySkills.forEach(s=>{
    if (skillPct[s]){
      sum += skillPct[s].pct; count++;
    }
  });
  let basePct = count ? Math.round(sum / count) : 0;

  if (skillPct['Writing']){
    const w = skillPct['Writing'].pct;
    if (w >= 80) basePct += 3;
    else if (w >= 60) basePct += 1;
    else if (w < 40) basePct -= 3;
  }
  basePct = Math.max(0, Math.min(100, basePct));
  const predictedLevel = cefrFromPercent(basePct);

  return { skillPct, reviewHits, predictedLevel, basePct };
}

/* ====== RESULTS UI ====== */
function showResults(){
  const name = $('#candidateName').value.trim() || 'Candidate';
  const { skillPct, reviewHits, predictedLevel, basePct } = scoreAll();

  $('#testArea').classList.add('hidden');
  $('#resultsArea').classList.remove('hidden');

  const res = $('#resultsSummary');
  res.innerHTML = '';

  const kpis = el('div',{class:'kpi'},
    el('div',{class:'card'},
      el('div',{}, el('strong',{}, 'Name'), el('div',{class:'badge'}, name))
    ),
    el('div',{class:'card'},
      el('div',{}, el('strong',{}, 'Predicted CEFR'), el('div',{class:'badge'}, predictedLevel))
    ),
    el('div',{class:'card'},
      el('div',{}, el('strong',{}, 'Overall %'), el('div',{class:'badge'}, `${basePct}%`))
    )
  );
  res.append(kpis);

  // Build chart
  const labels = Object.keys(skillPct);
  const data = labels.map(k=> skillPct[k].pct);
  const ctx = $('#skillsChart').getContext('2d');
  if (chartRef) chartRef.destroy();
  chartRef = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Score % by Skill', data }] },
    options: {
      responsive:true,
      scales: { y: { beginAtZero:true, max:100 } }
    }
  });

  // Ripasso list
  const ripasso = $('#ripassoList');
  ripasso.innerHTML = '';
  const sorted = Object.entries(reviewHits).sort((a,b)=>b[1]-a[1]).slice(0, 30);
  if (sorted.length === 0){
    ripasso.append(el('p',{}, "Excellent performance. Maintain your level with periodic reading/listening and targeted writing practice."));
  } else {
    const ul = el('ul',{class:'tight'});
    sorted.forEach(([tag,count])=>{
      const desc = RIPASSO_LIBRARY[tag] || 'Targeted practice for this micro-topic.';
      ul.append(el('li',{}, el('strong',{}, `${tag}`), ` — ${desc} `, el('span',{class:'badge'}, `x${count}`)));
    });
    ripasso.append(ul);
  }

  // Mistakes table (HTML view)
  const mt = $('#mistakesTable');
  mt.innerHTML = '';
  if (MISTAKES.length === 0){
    mt.append(el('p',{}, 'No mistakes to show. Great job!'));
  } else {
    const table = el('table',{style:'width:100%; border-collapse:collapse; font-size:14px;'});
    const header = el('tr', {style:'border-bottom:1px solid #2a3342'},
      el('th',{style:'text-align:left; padding:6px;'},'Section'),
      el('th',{style:'text-align:left; padding:6px;'},'Lvl'),
      el('th',{style:'text-align:left; padding:6px;'},'Prompt'),
      el('th',{style:'text-align:left; padding:6px;'},'Your answer'),
      el('th',{style:'text-align:left; padding:6px;'},'Correct')
    );
    table.append(header);
    MISTAKES.forEach(m=>{
      table.append(el('tr', {style:'border-top:1px solid #1e2632'},
        el('td',{style:'padding:6px; vertical-align:top;'}, m.section),
        el('td',{style:'padding:6px; vertical-align:top;'}, m.level),
        el('td',{style:'padding:6px; vertical-align:top;'}, m.prompt),
        el('td',{style:'padding:6px; vertical-align:top;'}, m.your || '—'),
        el('td',{style:'padding:6px; vertical-align:top;'}, m.correct)
      ));
    });
    mt.append(table);
  }
}

/* ====== PDF EXPORT (clean, white, includes mistakes) ====== */
async function downloadPdf(){
  const name = $('#candidateName').value.trim() || 'Candidate';
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit:'pt', format:'a4' });
  const margin = 40;
  let y = margin;

  // Header
  pdf.setFont('helvetica','bold'); pdf.setFontSize(18);
  pdf.text(`English Test Results — ${name}`, margin, y); y += 20;
  const kpiText = $('#resultsSummary').innerText.replace(/\s+\n/g,' ').trim();

  // KPIs (CEFR + %)
  const badges = [...document.querySelectorAll('#resultsSummary .badge')].map(b=>b.textContent);
  pdf.setFontSize(12); pdf.setFont('helvetica','normal');
  pdf.text(`Predicted CEFR: ${badges[1] || ''}    Overall: ${badges[2] || ''}`, margin, y); y += 16;

  // Chart image
  if (chartRef){
    const img = chartRef.toBase64Image();
    const pageW = pdf.internal.pageSize.getWidth();
    const chartW = pageW - margin*2;
    const chartH = chartW * 0.45;
    pdf.addImage(img, 'PNG', margin, y, chartW, chartH);
    y += chartH + 14;
  }

  // Skill summary table
  const skillRows = Object.entries(scoreAll().skillPct).map(([k,v])=>[k, `${v.correct}/${v.total}`, `${v.pct}%`]);
  pdf.autoTable({
    startY: y,
    head: [['Skill','Correct/Total','%']],
    body: skillRows,
    styles: { fontSize: 10 },
    margin: { left: margin, right: margin }
  });
  y = pdf.lastAutoTable.finalY + 18;

  // Ripasso (top 15)
  const reviewSorted = Object.entries(scoreAll().reviewHits || {}).sort((a,b)=>b[1]-a[1]).slice(0,15);
  if (reviewSorted.length){
    pdf.setFont('helvetica','bold'); pdf.setFontSize(14);
    pdf.text('Precise Ripasso (Personalised Review)', margin, y); y += 12;
    pdf.setFont('helvetica','normal'); pdf.setFontSize(10);
    reviewSorted.forEach(([tag,count])=>{
      const desc = RIPASSO_LIBRARY[tag] || 'Targeted practice for this micro-topic.';
      pdf.text(`• ${tag} — ${desc}   (x${count})`, margin, y, {maxWidth: pdf.internal.pageSize.getWidth() - margin*2});
      y += 12;
      if (y > pdf.internal.pageSize.getHeight() - 80){ pdf.addPage(); y = margin; }
    });
    y += 6;
  }

  // Mistakes table (paginated)
  const body = (MISTAKES.length ? MISTAKES : [{section:'—',level:'—',prompt:'No mistakes',your:'',correct:''}])
    .map(m => [m.section, m.level, m.prompt, m.your || '—', m.correct]);
  pdf.autoTable({
    startY: y,
    head: [['Section','Lvl','Prompt','Your answer','Correct']],
    body,
    styles: { fontSize: 9, cellWidth: 'wrap' },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 28 },
      2: { cellWidth: 190 },
      3: { cellWidth: 120 },
      4: { cellWidth: 120 }
    },
    margin: { left: margin, right: margin }
  });

  pdf.save(`English_Test_Results_${name.replace(/\s+/g,'_')}.pdf`);
}

/* ====== NAV ====== */
function goSection(delta){
  saveSectionAnswers();
  currentSectionIdx = Math.max(0, Math.min(DATA.sections.length-1, currentSectionIdx + delta));
  buildTabs();
  renderSection();
}

/* ====== INIT ====== */
async function init(){
  await loadData();

  $('#startBtn').addEventListener('click', ()=>{
    const name = $('#candidateName').value.trim();
    if (!name){ alert('Please enter your name.'); return; }
    $('#intro').classList.add('hidden');
    $('#testArea').classList.remove('hidden');
    currentSectionIdx = 0;
    buildTabs();
    renderSection();
  });
  $('#prevSection').addEventListener('click', ()=>goSection(-1));
  $('#nextSection').addEventListener('click', ()=>goSection(1));
  $('#finishBtn').addEventListener('click', ()=>{
    const unanswered = [];
    DATA.sections.forEach(s=>{
      s.items.forEach(it=>{
        if (it.type === 'mcq' || it.type === 'reading_mcq'){
          const v = answers[it.id];
          if (!v) unanswered.push(it.id);
        } else if (it.type === 'cloze'){
          const v = answers[it.id]||[];
          if (v.some(x=>!x || !x.toString().trim())) unanswered.push(it.id);
        } else {
          const v = answers[it.id];
          if (!v || !v.toString().trim()) unanswered.push(it.id);
        }
      });
    });
    if (unanswered.length > 0 && !confirm(`You have ${unanswered.length} unanswered item(s). Finish anyway?`)) return;

    showResults();
  });
  $('#downloadPdf').addEventListener('click', downloadPdf);
  $('#restartBtn').addEventListener('click', ()=>window.location.reload());
}

document.addEventListener('DOMContentLoaded', init);
