import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, ReferenceDot, Scatter } from 'recharts';
import { Upload, Calculator, Info, Thermometer, Database, FileSpreadsheet, List, X, TrendingUp, ArrowRightLeft, Search, Zap, Loader2, Lock, Mail, Key, LogOut } from 'lucide-react';

// ⭐️ 중요: 이 코드가 작동하려면 src 폴더 안에 supabase.js 파일이 있어야 합니다!
import { supabase } from './supabase'; 

// ==========================================
// 1. 상수 및 유틸리티 함수 (CSV 파싱 및 수학 계산)
// ==========================================
const WINTER_MONTHS = [12, 1, 2];
const SUMMER_MONTHS = [6, 7, 8];

const getTempFromDate = (dateStr) => {
  if (!dateStr) return 20;
  const month = new Date(dateStr).getMonth() + 1;
  const tempMap = { 1: -5, 2: 0, 3: 5, 4: 12, 5: 18, 6: 22, 7: 28, 8: 30, 9: 24, 10: 16, 11: 8, 12: 0 };
  return tempMap[month] !== undefined ? tempMap[month] : 20;
};

const getSeason = (dateStr) => {
  if (!dateStr) return 'other';
  const month = new Date(dateStr).getMonth() + 1;
  if (WINTER_MONTHS.includes(month)) return 'winter';
  if (SUMMER_MONTHS.includes(month)) return 'summer';
  return 'other';
};

const splitCSVRow = (row) => {
  const result = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') { inQuote = !inQuote; }
    else if (char === ',' && !inQuote) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current);
  return result;
};

const parseHistoryCSV = (lines) => {
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].includes('TS') && (lines[i].includes('압하율') || lines[i].includes('Reduction') || lines[i].includes('압하율(%)'))) {
      headerRowIndex = i; break;
    }
  }
  if (headerRowIndex === -1) return [];
  const headers = splitCSVRow(lines[headerRowIndex]).map(h => h.trim().replace(/^"|"$/g, ''));
  const findCol = (keywords) => {
    for (const k of keywords) {
      const idx = headers.findIndex(h => h === k || h.includes(k));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idx = {
    lot: findCol(['LOT No', 'Lot', 'LOT']),
    ts: findCol(['TS']),
    hv: findCol(['HV', 'Hardness', '경도']),
    reduction: findCol(['압하율(%)', '압하율', 'Reduction', '압하']),
    date: findCol(['작업일자', 'Date', 'WorkDate']),
    rawTs: findCol(['원소재 TS', '원소재TS', 'RawTS']),
    md30: findCol(['Md30', 'MD30']),
    thickness: findCol(['작업두께', '두께', 'Thickness', 'WorkThickness']),
    inputThickness: findCol(['투입두께', 'InputThickness', '투입'])
  };
  const parsedData = [];
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const row = splitCSVRow(lines[i]);
    if (row.length < 3) continue;
    const getVal = (index) => {
      if (index === -1 || !row[index]) return NaN;
      return parseFloat(row[index].replace(/^"|"$/g, '').replace(/,/g, '').replace('%', ''));
    };
    const dateStr = idx.date !== -1 && row[idx.date] ? row[idx.date].replace(/^"|"$/g, '').trim() : '';
    const lotStr = idx.lot !== -1 && row[idx.lot] ? row[idx.lot].replace(/^"|"$/g, '').trim() : '-';
    const thickness = getVal(idx.thickness);
    const inputThickness = getVal(idx.inputThickness);

    const item = {
      lot: lotStr, ts: getVal(idx.ts), hv: getVal(idx.hv),
      reduction: getVal(idx.reduction), date: dateStr,
      rawTs: getVal(idx.rawTs), md30: getVal(idx.md30),
      thickness: thickness,
      inputThickness: !isNaN(inputThickness) ? inputThickness : (thickness / (1 - getVal(idx.reduction)/100)),
      temp: getTempFromDate(dateStr)
    };
    if (!isNaN(item.ts) && item.ts > 500 && !isNaN(item.reduction) && item.reduction >= 0 && !isNaN(item.md30) && !isNaN(item.rawTs) && item.rawTs > 0) {
      parsedData.push(item);
    }
  }
  return parsedData;
};

// 기존 parseMaterialCSV 함수 전체를 아래 코드로 교체해주세요.
const parseMaterialCSV = (lines) => {
  let mainHeaderIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].includes('원자재No') || lines[i].includes('원자재 관리 No')) { mainHeaderIndex = i; break; }
  }
  if (mainHeaderIndex === -1) return [];
  
  const headerRow1 = splitCSVRow(lines[mainHeaderIndex]).map(h => h.trim().replace(/^"|"$/g, ''));
  const headerRow2 = (lines.length > mainHeaderIndex + 1) ? splitCSVRow(lines[mainHeaderIndex + 1]).map(h => h.trim().replace(/^"|"$/g, '')) : [];
  
  const findColumn = (keywords) => {
      for (const keyword of keywords) {
          let index = headerRow1.findIndex(h => h === keyword || h.includes(keyword));
          if (index !== -1) return index;
          index = headerRow2.findIndex(h => h === keyword || h.includes(keyword));
          if (index !== -1) return index;
      }
      return -1;
  };

  // ⭐️ 두 종류의 번호를 모두 찾도록 수정
  const idx = {
    mat1: findColumn(['원자재 관리 No']), 
    mat2: findColumn(['원자재No', 'LOT No']), 
    ts: findColumn(['인장강도(TS)', '인장강도', 'TS']),
    md30: findColumn(['Md30', 'MD30'])
  };

  const parsedMaterials = [];
  let dataStartIndex = mainHeaderIndex + 1;
  if (lines[dataStartIndex] && (lines[dataStartIndex].includes('값') || lines[dataStartIndex].includes('종류'))) { dataStartIndex++; }
  
  for (let i = dataStartIndex; i < lines.length; i++) {
    const row = splitCSVRow(lines[i]);
    if (row.length < 3) continue;
    
    const getVal = (index) => {
      if (index === -1 || index >= row.length || !row[index]) return NaN;
      return parseFloat(row[index].replace(/^"|"$/g, '').replace(/,/g, ''));
    };

    const m1 = idx.mat1 !== -1 && row[idx.mat1] ? row[idx.mat1].replace(/^"|"$/g, '').trim() : '';
    const m2 = idx.mat2 !== -1 && row[idx.mat2] ? row[idx.mat2].replace(/^"|"$/g, '').trim() : '';
    
    // ⭐️ 두 번호를 합쳐서 저장 (예: "W100206001 QGA1333") -> 둘 중 뭘로 검색해도 걸립니다!
    const matNo = `${m1} ${m2}`.trim();
    const ts = getVal(idx.ts);
    const md30 = getVal(idx.md30);
    
    if (matNo && (!isNaN(ts) || !isNaN(md30))) {
      parsedMaterials.push({ materialNo: matNo, rawTs: ts, md30: md30 });
    }
  }
  return parsedMaterials;
};

const calculateSimilarityScore = (d, inputParams) => {
  const scale = { ts: 100, hv: 30, md30: 2.0, rawTs: 30.0, thick: 0.2 };
  let diffVal = 0;
  if (inputParams.propertyMode === 'hv') {
      let refHv = inputParams.targetHv;
      if (inputParams.calcMode === 'ts') { 
          const rawHv = inputParams.rawTs / 3.1;
          refHv = rawHv + 5 * inputParams.inputReduction; 
      }
      diffVal = Math.abs((d.hv || d.ts/3.1) - refHv) / scale.hv;
  } else {
      let refTs = inputParams.targetTs;
      if (inputParams.calcMode === 'ts') refTs = inputParams.rawTs + 15 * inputParams.inputReduction;
      diffVal = Math.abs(d.ts - refTs) / scale.ts;
  }
  const diffMd30 = Math.abs(d.md30 - inputParams.md30);
  const diffRawTs = Math.abs(d.rawTs - inputParams.rawTs);
  let diffThick = inputParams.thicknessMode === 'target' 
    ? (!isNaN(d.thickness) ? Math.abs(d.thickness - inputParams.thicknessVal) : 0)
    : (!isNaN(d.inputThickness) ? Math.abs(d.inputThickness - inputParams.thicknessVal) : 0);
  const seasonPenalty = (getSeason(d.date) === getSeason(inputParams.workDate)) ? 0 : 0.5;
  return Math.sqrt(Math.pow(diffVal, 2) * 2.0 + Math.pow(diffMd30 / scale.md30, 2) * 1.5 + Math.pow(diffRawTs / scale.rawTs, 2) + Math.pow(diffThick / scale.thick, 2)) + seasonPenalty;
};

const calculateWeight = (score) => 1 / (score + 0.1);

const weightedPolynomialRegression = (points) => {
  if (points.length < 2) return null;
  let sumW = 0, sumWX = 0, sumWX2 = 0, sumWX3 = 0, sumWX4 = 0, sumWY = 0, sumWXY = 0, sumWX2Y = 0;
  points.forEach(p => {
      const x = p.x, y = p.y, w = p.weight || 1;
      sumW += w; sumWX += w*x; sumWX2 += w*x*x; sumWX3 += w*x*x*x; sumWX4 += w*x*x*x*x;
      sumWY += w*y; sumWXY += w*x*y; sumWX2Y += w*x*x*y;
  });
  const det = sumWX4 * sumWX2 - sumWX3 * sumWX3;
  if (Math.abs(det) < 1e-9) return null; 
  const a = (sumWX2Y * sumWX2 - sumWXY * sumWX3) / det;
  const b = (sumWX4 * sumWXY - sumWX3 * sumWX2Y) / det;
  return { a, b, c: 0, type: 'Weighted Poly2' };
};

const weightedLinearRegressionOrigin = (points) => {
  if (points.length < 1) return null;
  let sumWX2 = 0, sumWXY = 0;
  points.forEach(p => { const w = p.weight || 1; sumWX2 += w*p.x*p.x; sumWXY += w*p.x*p.y; });
  const slope = sumWX2 !== 0 ? sumWXY / sumWX2 : 0;
  return { slope, intercept: 0, type: 'Weighted Linear' };
};

const removeOutliersAdaptive = (dataList, propertyMode) => {
  if (dataList.length < 4) return { filtered: dataList, removed: [] };
  const getVal = (d) => (propertyMode === 'hv' ? (d.hv || d.ts / 3.1) : d.ts);
  const getRaw = (d) => (propertyMode === 'hv' ? (d.rawTs / 3.1) : d.rawTs);
  let sumX2 = 0, sumXY = 0;
  dataList.forEach(d => { const x = d.reduction; const y = getVal(d) - getRaw(d); sumX2 += x*x; sumXY += x*y; });
  const slope = sumX2 !== 0 ? sumXY / sumX2 : 0;
  const residuals = dataList.map(d => Math.abs((getVal(d) - getRaw(d)) - slope * d.reduction));
  const meanRes = residuals.reduce((a,b)=>a+b, 0) / residuals.length;
  const variance = residuals.reduce((a,b)=>a+Math.pow(b-meanRes, 2), 0) / residuals.length;
  const threshold = Math.max(2 * Math.sqrt(variance), propertyMode === 'hv' ? 15 : 40);
  const filtered = [], removed = [];
  dataList.forEach((d, i) => { if (residuals[i] <= threshold) filtered.push(d); else removed.push(d); });
  return { filtered, removed };
};


// ==========================================
// 2. 메인 React 컴포넌트
// ==========================================
const App = () => {
  // --- Auth & Loading State ---
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  
  // --- Data State ---
  const [data, setData] = useState([]); 
  const [materialData, setMaterialData] = useState([]); 
  const [usedData, setUsedData] = useState([]); 
  const [outlierData, setOutlierData] = useState([]); 
  const [isModalOpen, setIsModalOpen] = useState(false); 
  const [isFetching, setIsFetching] = useState(false); 
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({ history: null, material: null });
  const [dataStats, setDataStats] = useState({ total: 0, filtered: 0, criteria: '' });
  
  // --- App Logic State ---
  const [calcMode, setCalcMode] = useState('reduction'); 
  const [propertyMode, setPropertyMode] = useState('ts'); 
  const [inputs, setInputs] = useState({
    targetTs: 1300, targetHv: 400, inputReduction: 20, thicknessVal: 0.3, 
    thicknessMode: 'target', rawTs: 840, md30: 30, workDate: new Date().toISOString().split('T')[0], materialNo: '' 
  });
  const [result, setResult] = useState(null);

  // --- 1. 로그인/로그아웃 관련 로직 ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsAuthLoading(true); setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError('이메일이나 비밀번호가 맞지 않습니다.');
    setIsAuthLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setData([]); setMaterialData([]);
  };

// 📡 1. Supabase에서 데이터를 가져오는 함수 (수정된 부분)
  const fetchDatabase = async () => {
    try {
      setIsFetching(true);
      
      // ⭐️ select('*') 뒤에 .limit(10000)을 붙여서 10000건까지 한 번에 가져오라고 명시합니다.
      const { data: historyData, error: historyError } = await supabase
        .from('history_db')
        .select('*')
        .limit(10000); // 👈 이 부분을 추가했어요!
        
      if (historyError) throw historyError;

      const { data: matData, error: matError } = await supabase
        .from('material_db')
        .select('*')
        .limit(10000); // 👈 여기도 추가해 주세요!
        
      if (matError) throw matError;

      setData(historyData || []); 
      setMaterialData(matData || []);
      setDataStats(prev => ({ ...prev, total: (historyData || []).length }));

    } catch (error) {
      console.error("데이터베이스 불러오기 실패:", error);
      alert("데이터를 불러오지 못했습니다. DB 설정을 확인해주세요.");
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => { if (session) fetchDatabase(); }, [session]);

  // --- 3. CSV 파일 업로드 후 DB에 바로 저장하기 ---
  const handleFileUpload = async (event, type) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus(prev => ({ ...prev, [type]: 'loading' }));
    
    const tryRead = (encoding) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const lines = e.target.result.split(/\r?\n/).filter(line => line.trim().length > 0);
          let parsed = type === 'history' ? parseHistoryCSV(lines) : parseMaterialCSV(lines);
          resolve({ success: parsed.length > 0, data: parsed });
        };
        reader.onerror = () => resolve({ success: false, data: [] });
        reader.readAsText(file, encoding);
      });
    };

    try {
      let parsedResult = await tryRead('EUC-KR');
      if (!parsedResult.success) parsedResult = await tryRead('UTF-8');

      if (parsedResult.success && parsedResult.data.length > 0) {
        const tableName = type === 'history' ? 'history_db' : 'material_db';
        const { error } = await supabase.from(tableName).insert(parsedResult.data);
        if (error) throw error;

        setUploadStatus(prev => ({ ...prev, [type]: 'success' }));
        alert(`성공적으로 ${parsedResult.data.length}건의 데이터를 DB에 추가했습니다!`);
        fetchDatabase(); 
      } else {
        setUploadStatus(prev => ({ ...prev, [type]: 'error' }));
        alert('유효한 데이터를 찾지 못했습니다. 파일 구조를 확인해주세요.');
      }
    } catch (error) {
      console.error("DB 업로드 에러:", error);
      setUploadStatus(prev => ({ ...prev, [type]: 'error' }));
      alert(`업로드 실패: 데이터베이스의 컬럼명(영어 소문자)이 정확히 설정되었는지 확인해 주세요.\n(에러: ${error.message})`);
    } finally {
      setIsUploading(false);
      event.target.value = ''; 
    }
  };

  // --- 4. 사용자 입력 폼 핸들러 ---
// 검색을 수행하는 기존 searchMaterial 함수를 이것으로 교체해주세요. 
  const searchMaterial = () => {
    if (!inputs.materialNo) return;
    if (materialData.length === 0) { 
      alert("원소재 DB가 비어있습니다. DB 연동을 확인하거나 다시 업로드 해주세요."); 
      return; 
    }
    
    const searchKey = inputs.materialNo.trim().toLowerCase();
    
    // ⭐️ 대소문자 문제(materialNo vs materialno) 완벽 대응
    const found = materialData.find(m => {
      const matNo = m.materialNo || m.materialno || '';
      return matNo.toLowerCase().includes(searchKey);
    });

    if (found) {
      // ⭐️ 속성 이름 대소문자 문제 완벽 대응
      const ts = found.rawTs !== undefined ? found.rawTs : found.rawts;
      const md = found.md30 !== undefined ? found.md30 : found.md30;
      
      setInputs(prev => ({ 
        ...prev, 
        rawTs: !isNaN(ts) ? ts : prev.rawTs, 
        md30: !isNaN(md) ? md : prev.md30 
      }));
      
      // ⭐️ 시각적 피드백 제공
      alert(`[${found.materialNo || found.materialno}] 원소재 정보를 성공적으로 불러왔습니다!`);
    } else { 
      alert(`'${inputs.materialNo}' (을)를 원소재 DB에서 찾을 수 없습니다.`); 
    }
  };

  // --- 5. 핵심 계산 로직 (데이터가 바뀌거나 입력이 바뀔 때 실행) ---
  useEffect(() => {
    if (!data.length) return;
    const { md30: inMd30, rawTs: inRawTs, targetTs, targetHv, inputReduction, thicknessVal, thicknessMode, workDate } = inputs;
    if (isNaN(inMd30) || isNaN(inRawTs)) { setResult(null); return; }
    const targetValue = propertyMode === 'ts' ? targetTs : targetHv;
    if (calcMode === 'reduction' && isNaN(targetValue)) return;
    if (calcMode === 'ts' && isNaN(inputReduction)) return;
    const inRawValue = propertyMode === 'ts' ? inRawTs : (inRawTs / 3.1);

    const scoredData = data.map(d => ({ ...d, score: calculateSimilarityScore(d, { ...inputs, calcMode, propertyMode }) }));
    scoredData.sort((a, b) => a.score - b.score);
    const topN = Math.max(5, Math.min(30, Math.floor(data.length * 0.3)));
    const candidateData = scoredData.slice(0, topN);

    const { filtered: finalData, removed: outliers } = removeOutliersAdaptive(candidateData, propertyMode);
    const weightedData = finalData.map(d => ({ ...d, weight: calculateWeight(d.score) }));

    let sumW = 0, sumMd30 = 0, sumRaw = 0, sumTemp = 0;
    if (weightedData.length > 0) {
        weightedData.forEach(d => {
            const w = d.weight || 1;
            sumW += w; sumMd30 += d.md30 * w; sumRaw += d.rawTs * w; sumTemp += (d.temp || 20) * w;
        });
    }
    const grpMd30 = sumW ? sumMd30 / sumW : inMd30;
    const grpRawTs = sumW ? sumRaw / sumW : inRawTs;
    const grpTemp = sumW ? sumTemp / sumW : 20;
    const inTemp = getTempFromDate(workDate);

    let corrMd30 = (inMd30 - grpMd30) * 2.5;
    let corrRawTs = (inRawTs - grpRawTs) * 0.5;
    let corrTemp = (inTemp - grpTemp) * (-1.25);
    if (propertyMode === 'hv') { corrMd30 /= 3.1; corrRawTs /= 3.1; corrTemp /= 3.1; }
    const totalCorrection = corrMd30 + corrRawTs + corrTemp;

    const processedData = weightedData.map(d => {
        let val = propertyMode === 'ts' ? d.ts : (d.hv || d.ts/3.1);
        let raw = propertyMode === 'ts' ? d.rawTs : (d.rawTs/3.1);
        return { ...d, normTs: val - raw + inRawValue + totalCorrection, correction: totalCorrection };
    });

    setUsedData(processedData); setOutlierData(outliers);
    setDataStats(prev => ({ ...prev, filtered: processedData.length, criteria: `유사도 상위 (가중분석)` }));

    const regressionPoints = processedData.map(d => ({
        x: d.reduction, 
        y: propertyMode === 'ts' ? (d.ts - d.rawTs) : ((d.hv || (d.ts / 3.1)) - (d.rawTs / 3.1)), 
        weight: d.weight 
    }));

    let model = null; let regressionType = '';
    if (regressionPoints.length >= 5) {
        model = weightedPolynomialRegression(regressionPoints);
        if (model && (model.a < -0.2 || model.a > 0.5)) model = null;
        else if (model) regressionType = 'Adaptive Poly2';
    }
    if (!model && regressionPoints.length >= 1) {
        const linear = weightedLinearRegressionOrigin(regressionPoints);
        model = { a: 0, b: linear.slope, c: 0 }; regressionType = 'Adaptive Linear';
    }
    if (!model) {
        model = { a: 0, b: propertyMode === 'ts' ? 15 : 5, c: 0 }; regressionType = 'Standard (Fallback)';
    }

    if (calcMode === 'reduction') {
        const neededDelta = targetValue - inRawValue - totalCorrection;
        const { a, b } = model;
        const c_eq = -neededDelta;
        let resR = 0;
        if (Math.abs(a) < 1e-6) { resR = b !== 0 ? -c_eq / b : 0; } 
        else {
            const disc = b*b - 4*a*c_eq;
            if (disc >= 0) {
                const r1 = (-b + Math.sqrt(disc)) / (2*a); const r2 = (-b - Math.sqrt(disc)) / (2*a);
                if (r1 > 0 && r2 > 0) resR = Math.min(r1, r2); else resR = r1 > 0 ? r1 : r2;
            } else { resR = b !== 0 ? -c_eq / b : 0; }
        }
        resR = Math.max(0, Math.min(95, resR));
        let compThick = thicknessMode === 'target' ? thicknessVal / (1 - resR/100) : thicknessVal * (1 - resR/100);
        setResult({ reduction: resR, resultVal: targetValue, model, correction: totalCorrection, correctionDetail: { md30: corrMd30, raw: corrRawTs, temp: corrTemp }, computedThickness: compThick, regressionType, dataCount: processedData.length });
    } else {
        const R = parseFloat(inputReduction);
        const predVal = inRawValue + (model.a * R * R + model.b * R) + totalCorrection;
        let compThick = thicknessMode === 'target' ? thicknessVal / (1 - R/100) : thicknessVal * (1 - R/100);
        setResult({ reduction: R, resultVal: predVal, model, correction: totalCorrection, correctionDetail: { md30: corrMd30, raw: corrRawTs, temp: corrTemp }, computedThickness: compThick, regressionType, dataCount: processedData.length });
    }
  }, [inputs, data, calcMode, propertyMode]);

  // --- 6. 차트 데이터 메모이제이션 ---
  const chartData = useMemo(() => {
    if (!result) return { trends: [], scatterPoints: [], outlierPoints: [] };
    const inRawValue = propertyMode === 'ts' ? inputs.rawTs : (inputs.rawTs / 3.1);
    const scatterPoints = usedData.map(d => ({ reduction: d.reduction, val: d.normTs, season: getSeason(d.date), weight: d.weight }));
    const outlierPoints = outlierData.map(d => ({ reduction: d.reduction, val: propertyMode === 'ts' ? d.ts : (d.hv || d.ts/3.1), season: getSeason(d.date) }));
    const trends = [];
    const { a, b } = result.model;
    let prevY = inRawValue + result.correction;
    for (let i = 0; i <= 90; i += 5) {
        let predY = inRawValue + (a * i * i + b * i) + result.correction;
        if (i > 0 && predY < prevY) predY = prevY; 
        prevY = predY;
        trends.push({ reduction: i, predicted: predY });
    }
    return { trends, scatterPoints, outlierPoints };
  }, [usedData, outlierData, result, inputs.rawTs, propertyMode]);

  const isValidDisplay = result !== null && !isNaN(result.reduction);

  // ==========================================
  // 3. UI 렌더링 (로그인 화면 & 메인 앱 화면)
  // ==========================================
  
  if (isAuthLoading && !session) {
    return <div className="min-h-screen bg-slate-50 flex justify-center items-center"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  }

  // --- 화면 A: 로그인 폼 ---
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex justify-center items-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border border-slate-200">
          <div className="text-center mb-8">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Lock className="w-8 h-8 text-blue-600" /></div>
            <h1 className="text-2xl font-bold text-slate-800">보안 로그인</h1>
            <p className="text-slate-500 mt-2 text-sm">승인된 관리자만 계산기에 접근할 수 있습니다.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">이메일</label>
              <div className="relative">
                <Mail className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-500" placeholder="admin@company.com" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">비밀번호</label>
              <div className="relative">
                <Key className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-blue-500" placeholder="••••••••" />
              </div>
            </div>
            {loginError && <p className="text-red-500 text-sm font-medium text-center">{loginError}</p>}
            <button type="submit" disabled={isAuthLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg transition-colors flex justify-center items-center gap-2 mt-6">
              {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : '로그인'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- 화면 B: 메인 계산기 앱 ---
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto">
        
        {/* 헤더 */}
        <header className="mb-8 border-b pb-4 border-slate-200 flex justify-between items-center">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2">
              <Calculator className="w-8 h-8 text-blue-600" /> STS 냉간압연 압하율 계산기
            </h1>
            <p className="text-slate-500 mt-1 text-sm">v10.5 (Cloud DB & Auth Sync)</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden md:block">
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium">접속중: {session.user.email}</span>
            </div>
            <button onClick={handleLogout} className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-600 transition-colors border border-slate-300 px-3 py-1.5 rounded-lg bg-white">
              <LogOut className="w-4 h-4" /> 로그아웃
            </button>
          </div>
        </header>

        {isFetching ? (
          <div className="flex flex-col justify-center items-center h-64 gap-4">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-blue-600 font-bold">클라우드 데이터베이스 연동 중... 🚀</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* 왼쪽 패널 (DB 상태 & 폼 입력) */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* DB 연동 상태 및 업로드 버튼 */}
              <div className="space-y-3">
                <div className={`bg-white p-4 rounded-xl shadow-sm border ${uploadStatus.history === 'error' ? 'border-red-300' : uploadStatus.history === 'success' ? 'border-green-300' : 'border-slate-200'}`}>
                  <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex justify-between items-center">
                    <span className="flex items-center gap-2"><Database className="w-4 h-4 text-blue-600" /> 클라우드 이력 DB ({data.length}건)</span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <label className={`flex-1 cursor-pointer text-xs py-2 px-3 rounded border transition-colors flex items-center justify-center gap-2 ${isUploading ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'}`}>
                      {uploadStatus.history === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} 
                      {uploadStatus.history === 'loading' ? "DB 업로드 중..." : "새 이력 CSV 파일 DB에 추가"}
                      <input type="file" accept=".csv" onChange={(e) => handleFileUpload(e, 'history')} className="hidden" disabled={isUploading} />
                    </label>
                  </div>
                </div>

                <div className={`bg-white p-4 rounded-xl shadow-sm border ${uploadStatus.material === 'error' ? 'border-red-300' : uploadStatus.material === 'success' ? 'border-green-300' : 'border-slate-200'}`}>
                  <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2 flex justify-between items-center">
                    <span className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> 원소재 DB ({materialData.length}건)</span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <label className={`flex-1 cursor-pointer text-xs py-2 px-3 rounded border transition-colors flex items-center justify-center gap-2 ${isUploading ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                      {uploadStatus.material === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} 
                      {uploadStatus.material === 'loading' ? "DB 업로드 중..." : "새 원소재 CSV 파일 DB에 추가"}
                      <input type="file" accept=".csv" onChange={(e) => handleFileUpload(e, 'material')} className="hidden" disabled={isUploading} />
                    </label>
                  </div>
                </div>
              </div>

              {/* 공정 조건 입력 폼 */}
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2"><Info className="w-4 h-4" /> 공정 조건 입력</h2>
                    <div className="flex gap-2">
                      <button onClick={togglePropertyMode} className={`text-xs px-3 py-1 rounded-full border ${propertyMode === 'ts' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{propertyMode === 'ts' ? 'TS 기준' : '경도(HV)'}</button>
                      <button onClick={toggleCalcMode} className="text-xs bg-slate-100 px-3 py-1 rounded-full border flex items-center gap-1"><ArrowRightLeft className="w-3 h-3" /> {calcMode === 'reduction' ? '역산' : '예측'}</button>
                    </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                    <label className="block text-xs font-bold text-blue-800 mb-1">원자재 No 검색</label>
                    <div className="flex gap-2">
                      <input type="text" value={inputs.materialNo} onChange={(e) => handleNumberInput('materialNo', e.target.value)} onKeyDown={handleKeyDown} autoComplete="off" className="flex-1 px-3 py-1.5 text-sm border border-blue-200 rounded outline-none" placeholder="DB에서 검색 (예: W100206001)" />
                      <button onClick={searchMaterial} className="bg-blue-600 text-white p-1.5 rounded hover:bg-blue-700"><Search className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">작업 일자</label>
                    <input type="date" value={inputs.workDate} onChange={(e) => setInputs({...inputs, workDate: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">원소재 TS</label>
                      <input type="number" step="any" autoComplete="off" inputMode="decimal" value={inputs.rawTs} onChange={(e) => handleNumberInput('rawTs', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-slate-50" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Md30</label>
                      <input type="number" step="any" autoComplete="off" inputMode="decimal" value={inputs.md30} onChange={(e) => handleNumberInput('md30', e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none bg-slate-50" />
                    </div>
                  </div>
                  <div className="border-t border-slate-100 my-4 pt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        {calcMode === 'reduction' ? (
                            <>
                              <label className={`block text-sm font-medium mb-1 ${propertyMode==='ts'?'text-blue-900':'text-purple-900'}`}>목표 {propertyMode === 'ts' ? 'TS' : 'HV'}</label>
                              <input type="number" step="any" autoComplete="off" inputMode="decimal" value={propertyMode === 'ts' ? inputs.targetTs : inputs.targetHv} onChange={(e) => handleNumberInput(propertyMode === 'ts' ? 'targetTs' : 'targetHv', e.target.value)} className={`w-full px-3 py-2 border rounded-lg outline-none font-bold ${propertyMode==='ts'?'border-blue-200 bg-blue-50 text-blue-900':'border-purple-200 bg-purple-50 text-purple-900'}`} />
                            </>
                        ) : (
                            <>
                              <label className="block text-sm font-medium text-blue-900 mb-1">입력 압하율 (%)</label>
                              <input type="number" step="any" autoComplete="off" inputMode="decimal" value={inputs.inputReduction} onChange={(e) => handleNumberInput('inputReduction', e.target.value)} className="w-full px-3 py-2 border border-blue-200 bg-blue-50 rounded-lg outline-none font-bold text-blue-900" />
                            </>
                        )}
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-sm font-medium text-slate-700 cursor-pointer flex items-center gap-1 hover:text-blue-600" onClick={toggleThicknessMode}>{inputs.thicknessMode === 'target' ? '목표 두께' : '투입 두께'} <ArrowRightLeft className="w-3 h-3" /></label>
                        </div>
                        <input type="number" step="any" autoComplete="off" inputMode="decimal" value={inputs.thicknessVal} onChange={(e) => handleNumberInput('thicknessVal', e.target.value)} className={`w-full px-3 py-2 border rounded-lg outline-none font-bold ${inputs.thicknessMode === 'target' ? 'border-green-200 bg-green-50 text-green-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 결과 디스플레이 */}
                <div className="mt-4 bg-slate-900 text-white p-4 rounded-lg shadow-inner">
                   <div className="text-xs text-slate-400 mb-1 uppercase">{calcMode === 'reduction' ? '권장 압하율' : `예상 ${propertyMode === 'ts' ? 'TS' : 'HV'}`}</div>
                   <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-3xl font-bold text-green-400">{calcMode === 'reduction' ? (result ? `${result.reduction.toFixed(1)}%` : '--') : (result ? `${result.resultVal.toFixed(0)}` : '--')}</span>
                      <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded flex items-center gap-1"><Zap className="w-3 h-3" /> {result?.regressionType || 'Ready'}</span>
                   </div>
                   {isValidDisplay && (
                     <div className="text-sm text-slate-200 mt-2 p-2 bg-slate-800 rounded border border-slate-700 flex flex-col gap-1">
                       <div className="flex justify-between"><span className="text-slate-400">Input (투입)</span><span className="font-mono">{inputs.thicknessMode === 'target' ? (result.computedThickness === Infinity ? '0.000' : result.computedThickness.toFixed(3)) : parseFloat(inputs.thicknessVal || 0).toFixed(3)}mm</span></div>
                       <div className="w-full h-px bg-slate-700 my-0.5"></div>
                       <div className="flex justify-between"><span className="text-slate-400">Target (목표)</span><span className="font-mono font-bold text-green-400">{inputs.thicknessMode === 'target' ? parseFloat(inputs.thicknessVal || 0).toFixed(3) : (result.computedThickness === Infinity ? '0.000' : result.computedThickness.toFixed(3))}mm</span></div>
                     </div>
                   )}
                   <div className="mt-2 pt-2 border-t border-slate-700 flex justify-between items-center">
                       <span className="text-[10px] text-slate-400">분석된 데이터: {dataStats.filtered}건</span>
                       <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-1 text-[10px] text-white bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded transition-colors" disabled={!result}><List className="w-3 h-3" /> 상세 데이터 보기</button>
                   </div>
                </div>
              </div>
            </div>

            {/* 오른쪽 차트 영역 */}
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-[600px] flex flex-col">
                <div className="mb-4 flex justify-between items-center flex-wrap gap-2">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2"><Thermometer className="w-5 h-5 text-slate-500" /> {propertyMode === 'ts' ? 'TS' : '경도(HV)'} 예측 분석</h3>
                  <div className="flex gap-4 text-xs md:text-sm">
                    <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-slate-300"></div><span className="text-slate-500">유사 백데이터</span></div>
                    <div className="flex items-center gap-1"><div className="w-3 h-1 bg-blue-500"></div><span className="text-blue-600 font-bold">보정된 예측선</span></div>
                  </div>
                </div>
                <div className="flex-1 w-full min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="reduction" type="number" domain={[0, 90]} unit="%" label={{ value: '압하율 (%)', position: 'insideBottom', offset: -10 }} />
                      <YAxis domain={[dataMin => Math.max(0, Math.floor(dataMin * 0.9)), 'auto']} unit={propertyMode === 'ts' ? ' MPa' : ' HV'} label={{ value: propertyMode === 'ts' ? 'TS' : 'HV', angle: -90, position: 'insideLeft' }} />
                      <Tooltip content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="bg-white/95 p-3 border border-slate-200 shadow-lg rounded-lg text-xs">
                                <p className="font-bold mb-1">압하율: {label}%</p>
                                {payload.map((entry, index) => <p key={index} style={{ color: entry.color }}>{entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(0) : entry.value}</p>)}
                              </div>
                            );
                          }
                          return null;
                        }} />
                      <Scatter data={chartData.scatterPoints} dataKey="val" fill="#64748b" name="유사 데이터" shape="circle" r={4} opacity={0.8} />
                      <Scatter data={chartData.outlierPoints} dataKey="val" fill="#fca5a5" name="제외된 이상치" shape="cross" r={3} opacity={0.6} />
                      <Line data={chartData.trends} dataKey="predicted" stroke="#3b82f6" strokeWidth={3} dot={false} type="monotone" name="예측 곡선" />
                      {isValidDisplay && (
                          <ReferenceDot x={calcMode === 'reduction' ? result.reduction : parseFloat(inputs.inputReduction)} y={calcMode === 'reduction' ? (propertyMode==='ts'?inputs.targetTs:inputs.targetHv) : result.resultVal} r={6} fill="#10b981" stroke="#fff" strokeWidth={2} label={{ value: calcMode === 'reduction' ? '목표' : '예상', position: 'top', fill: '#10b981', fontWeight: 'bold' }} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-slate-400 mt-2 text-center">* 회색 점은 현재 조건(원소재/성분)에 맞게 보정된 유사 백데이터입니다. 이상치는 자동으로 회귀분석에서 제외됩니다.</p>
              </div>
            </div>
          </div>
        )}

        {/* --- 상세 데이터 모달 창 --- */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
              <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
                <div>
                  <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><List className="w-5 h-5 text-blue-600" /> 유사 데이터 상세 (Top {usedData.length})</h3>
                  <div className="flex gap-4 text-xs text-slate-500 mt-1">
                    <span>활용: {usedData.length}건</span>
                    <span>제외: {outlierData.length}건</span>
                    {result?.correctionDetail && <span className="text-blue-600 font-medium ml-2">보정(Gap): {result.correction > 0 ? '+' : ''}{result.correction.toFixed(1)}</span>}
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full"><X className="w-5 h-5 text-slate-500" /></button>
              </div>
              <div className="overflow-y-auto p-4">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-600 sticky top-0">
                    <tr><th className="p-3 border-b">점수</th><th className="p-3 border-b">LOT No</th><th className="p-3 border-b">작업일자</th><th className="p-3 border-b">실제TS</th><th className="p-3 border-b">실제HV</th><th className="p-3 border-b">압하율</th><th className="p-3 border-b">두께</th><th className="p-3 border-b">Md30</th><th className="p-3 border-b">원소재TS</th></tr>
                  </thead>
                  <tbody>
                    {usedData.map((row, idx) => (
                      <tr key={`used-${idx}`} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                        <td className="p-3 text-slate-500">{row.score.toFixed(2)}</td>
                        <td className="p-3 font-mono text-xs text-slate-500">{row.lot || '-'}</td>
                        <td className="p-3 text-slate-600">{row.date}</td>
                        <td className="p-3 text-slate-800 font-bold">{row.ts}</td>
                        <td className="p-3 text-slate-600">{row.hv || '-'}</td>
                        <td className="p-3 text-blue-600 font-bold">{row.reduction}%</td>
                        <td className="p-3">{row.thickness}</td>
                        <td className="p-3">{row.md30}</td>
                        <td className="p-3">{row.rawTs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t bg-slate-50 rounded-b-xl text-right">
                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700">닫기</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;