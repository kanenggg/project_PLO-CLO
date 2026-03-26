/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "../../utils/apiClient";
import { useGlobalToast } from "@/app/context/ToastContext";
import { useTranslation } from "next-i18next";
import LoadingOverlay from "@/components/LoadingOverlay";
import { AlertCircle, AlertTriangle, Save, Search } from "lucide-react";

// --- Types ---
interface PLO {
  id: number;
  code: string;
  name_en: string;
  name_th: string;
  program_id: number;
}

interface CLO {
  id: number;
  code: string;
  name_en: string;
}

// 🟢 FIX: Renamed prop to 'masterCourseId' to avoid confusion with Section ID
export default function CloPloMapping({
  masterCourseId,
  semesterId,
}: {
  masterCourseId: string | number; // This must be the MASTER Course ID (e.g. CS101), NOT Section ID
  semesterId: string | number;
}) {
  const { token } = useAuth();
  const { showToast } = useGlobalToast();
  const { t, i18n } = useTranslation("common");
  const lang = i18n.language;
  const [loading, setLoading] = useState(false);

  // --- SELECTION STATES ---
  const [plos, setPlos] = useState<PLO[]>([]);
  const [clos, setClos] = useState<CLO[]>([]);
  const [mappingGrid, setMappingGrid] = useState<Record<number, number>>({});

  const [changedKeys, setChangedKeys] = useState<Set<number>>(new Set());
  const [programs, setPrograms] = useState<any[]>([]);

  // 1. ฟังก์ชันดึง IDs ของหลักสูตรที่ผูกกับเทอมนี้
  const fetchProgramId = async () => {
    try {
      const res = await apiClient.get(
        `/programOnCourse?semester_id=${semesterId}`,
      );
      setPrograms(res.data);
      return Array.isArray(res.data)
        ? res.data.map((item: any) => item.program_id)
        : [];
    } catch {
      showToast(t("Failed to load programs"), "error");
      return [];
    }
  };

  // 2. ฟังก์ชันหลักในการโหลด PLOs ทั้งหมด
  const loadPloData = useCallback(async () => {
    setLoading(true);
    try {
      const currentIds = await fetchProgramId();

      if (currentIds.length === 0) {
        setPlos([]);
        return;
      }

      // ดึง PLOs ของทุกหลักสูตรพร้อมกันใน Request เดียว
      const res = await apiClient.get(
        `/plo?programId=${currentIds.join(",")}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      setPlos(res.data);
    } catch (err) {
      console.error("Load PLO Error:", err);
      showToast(t("Failed to load PLO data"), "error");
    } finally {
      setLoading(false);
    }
  }, [semesterId, token, t]);

  useEffect(() => {
    if (token && semesterId) loadPloData();
  }, [loadPloData, token, semesterId]);

  // 3. จัดกลุ่ม PLO ตาม Program ID เพื่อนำไป Loop แสดงผลใน UI
  const groupedPlos = useMemo(() => {
    return programs.reduce((acc: Record<number, any>, prog: any) => {
      const pId = prog.program_id;

      // 🟢 ดึงข้อมูลมาเฉยๆ โดยไม่ต้องสั่ง .sort()
      const associatedPlos = plos.filter((plo) => plo.program_id === pId);

      acc[pId] = {
        info: prog.program || prog,
        plos: associatedPlos, // <--- ลำดับจะเป็นไปตามที่ API ส่งมา
      };
      return acc;
    }, {});
  }, [plos, programs]);

  // B. Fetch CLOs AND Existing Mappings
  useEffect(() => {
    // 🟢 ตรวจสอบเงื่อนไข: ต้องมีทั้ง Course และ Semester ถึงจะโหลดข้อมูล
    if (!masterCourseId || !semesterId || !token) {
      setClos([]);
      setMappingGrid({});
      return;
    }

    setLoading(true);

    // เตรียม list ของ program_id (สมมติว่าคุณมีตัวแปร programIds เป็น array หรือ string "7,8")
    const pIds = Array.isArray(programs) ? programs.map((p) => p.program_id).join(",") : "";

    Promise.all([
      // 1. ดึงข้อมูล CLO ของวิชานี้
      apiClient.get(`/clo?courseId=${masterCourseId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      // 2. ดึง Mapping โดยส่ง semesterId และ programId ไปด้วย
      apiClient.get(`/mapping/clo-plo/${masterCourseId}`, {
        params: {
          semesterId: semesterId,
          programId: pIds, // ส่งเพื่อให้ Backend กรองเฉพาะหลักสูตรที่เกี่ยวข้อง
        },
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
      .then(([cloRes, mappingRes]) => {
        setClos(cloRes.data);

        const newGrid: Record<number, number> = {};
        const mappings = Array.isArray(mappingRes.data) ? mappingRes.data : [];

        mappings.forEach((m: any) => {
          // 🟢 สำคัญ: สร้าง Key ให้ตรงกับตอน Save (4 มิติ)
          // เพื่อให้ข้อมูลไม่ปนกันระหว่าง Program และ Semester
          const key = `${m.clo_id}_${m.plo_id}_${m.program_id}_${m.semester_id}`;
          newGrid[key] = Number(m.weight);
        });

        setMappingGrid(newGrid);
        setChangedKeys(new Set()); // ล้างรายการที่ค้างไว้
      })
      .catch((err) => {
        console.error("Error loading matrix:", err);
        showToast(t("Failed to load matrix data"), "error");
      })
      .finally(() => {
        setLoading(false);
      });

    // 🟢 เพิ่ม semesterId เข้าไปใน deps เพื่อให้โหลดใหม่ทุกครั้งที่เปลี่ยนเทอม
  }, [masterCourseId, semesterId, token, showToast, t]);

  // --------------------------------------------------------
  // 3. VALIDATION & HANDLERS
  // --------------------------------------------------------

  // 🟢 เพิ่ม programId เป็น parameter ตัวที่ 3
  const handleWeightChange = (
    cloId: number,
    ploId: number,
    programId: number,
    val: string,
  ) => {
    // 1. อนุญาตให้เป็นค่าว่างได้ (เพื่อการลบ) และต้องเป็นตัวเลขเท่านั้น
    if (val !== "" && isNaN(Number(val))) return;

    // 2. จำกัดไม่ให้เกิน 100 (ถ้าต้องการ)
    if (Number(val) > 100) return;

    // 3. สร้าง Key 4 มิติ (ต้องมั่นใจว่า semesterId มีค่า)
    const key = `${cloId}_${ploId}_${programId}_${semesterId}`;

    setMappingGrid((prev) => ({
      ...prev,
      [key]: val,
    }));

    setChangedKeys((prev) => new Set(prev).add(key));
  };

  // const cloTotals = useMemo(() => {
  //   const totals: Record<number, number> = {};

  //   Object.keys(mappingGrid).forEach((key) => {
  //     const [cloIdStr] = key.split("_");
  //     const cloId = Number(cloIdStr);

  //     // 🟢 FIX: Explicitly cast to Number and handle NaN/undefined
  //     const rawValue = mappingGrid[key];
  //     const weight = Number(rawValue) || 0;

  //     if (clos.some((c) => c.id === cloId)) {
  //       // 🟢 FIX: Use parseFloat or Number to ensure mathematical addition
  //       const currentTotal = totals[cloId] || 0;
  //       totals[cloId] = Number((currentTotal + weight).toFixed(4));
  //     }
  //   });

  //   clos.forEach((clo) => {
  //     if (!(clo.id in totals)) {
  //       totals[clo.id] = 0;
  //     }
  //   });

  //   return totals;
  // }, [mappingGrid, clos]);

  const [activeProgramId, setActiveProgramId] = useState<number | null>(null);

  // เมื่อ plos โหลดมาแล้ว ให้เลือก Program แรกเป็นค่าเริ่มต้นอัตโนมัติ
  useEffect(() => {
    if (plos.length > 0 && !activeProgramId) {
      setActiveProgramId(plos[0].program_id);
    }
  }, [plos, activeProgramId]);

  // กรองเฉพาะ PLO ของหลักสูตรที่เลือกอยู่
  const filteredPlos = useMemo(() => {
    return plos
      .filter((p) => p.program_id === activeProgramId)
      .sort((a, b) =>
        // 🟢 เรียงลำดับแบบ Numeric (PLO1, PLO2, ..., PLO10)
        a.code.localeCompare(b.code, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [plos, activeProgramId]);

  const isValidationSuccess = useMemo(() => {
    // 1. ป้องกัน Error: ถ้าไม่มี ID หรือข้อมูลยังไม่มา ให้ถือว่ายังไม่ต้อง Validate (คืนค่า true)
    if (!activeProgramId || !groupedPlos || !groupedPlos[activeProgramId]) {
      return true;
    }

    // 2. ดึง PLOs ของ Program ปัจจุบันออกมา (ใส่ Type Casting ถ้าจำเป็น)
    const currentProgramPlos = groupedPlos[activeProgramId]?.plos || [];
    if (currentProgramPlos.length === 0) return true;

    // 3. ตรวจสอบแต่ละแถว (CLO)
    return clos.every((clo) => {
      // หาผลรวมเฉพาะใน Grid ของ Program ที่เลือกอยู่
      const rowTotal = currentProgramPlos.reduce((sum, plo) => {
        const key = `${clo.id}_${plo.id}_${activeProgramId}`;
        return sum + (Number(mappingGrid[key]) || 0);
      }, 0);

      // เงื่อนไข: ถ้าแถวนั้นมีการกรอก (Total > 0) ต้องรวมได้ 100%
      // หรือถ้ายังไม่กรอกเลย (Total === 0) ก็ให้ผ่าน
      return rowTotal === 0 || Math.abs(rowTotal - 100) < 0.01;
    });
  }, [mappingGrid, activeProgramId, clos, groupedPlos]);

  const handleSave = async () => {
    if (!token) return;

    if (changedKeys.size === 0) {
      showToast(t("No changes to save"), "success");
      return;
    }

    if (!isValidationSuccess) {
      showToast(t("please ensure all row totals reach 100 percent"), "error");
      return;
    }

    setLoading(true);

    const updates = Array.from(changedKeys).map((key) => {
      const [cloId, ploId, programId, semId] = key.split("_"); // 🟢 ดึง semId ออกมา
      return {
        clo_id: Number(cloId),
        plo_id: Number(ploId),
        program_id: Number(programId),
        semester_id: Number(semId), // 🟢 ส่งไป Backend
        weight: Number(mappingGrid[key]) || 0,
      };
    });

    try {
      await apiClient.post(
        "/mapping/clo-plo",
        { updates }, // 🟢 ส่งแค่ updates ก้อนเดียวพอ
        { headers: { Authorization: `Bearer ${token}` } },
      );

      showToast(t("Mapping saved successfully!"), "success");
      setChangedKeys(new Set());
    } catch (err: any) {
      console.error("Save Error:", err);
      showToast(
        err.response?.data?.message || t("Failed to save mapping"),
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------------
  // 4. UI RENDER
  // --------------------------------------------------------
  return (
    <div className="mt-8 space-y-6 animate-in fade-in duration-500">
      {loading && <LoadingOverlay />}

      {/* Header & Save Action */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-2">
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-[0.2em]">
            {t("CLO to PLO Mapping Matrix")}
          </h3>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">
            Distribute weight percentage for each outcome
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={loading || !isValidationSuccess || changedKeys.size === 0}
          className={`px-8 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all flex items-center gap-2 shadow-xl active:scale-95 
  ${
    // กรณีที่แก้แล้วแต่กรอกไม่ครบ 100%
    !isValidationSuccess
      ? "bg-rose-100 text-rose-500 cursor-not-allowed opacity-70 border-2 border-rose-200"
      : changedKeys.size === 0
        ? "bg-slate-100 text-slate-400 cursor-not-allowed" // ยังไม่มีการแก้
        : "bg-slate-900 text-white hover:bg-emerald-600 shadow-emerald-200" // พร้อม Save
  }`}
        >
          {loading ? (
            t("Syncing...")
          ) : (
            <>
              <Save size={16} />
              {t("Save Changes")}{" "}
              {changedKeys.size > 0 && `(${changedKeys.size})`}
            </>
          )}
        </button>
      </div>

      {/* Main Content Container */}

      <div className="space-y-6">
        {/* --- 1. Program Selection Tabs --- */}
        {Object.keys(groupedPlos).length > 1 && (
          <div className="flex flex-wrap gap-2 p-2 bg-slate-100/50 rounded-[2rem] border border-slate-200 w-fit">
            {Object.entries(groupedPlos).map(([pId, data]: [string, any]) => (
              <button
                key={pId}
                onClick={() => setActiveProgramId(Number(pId))}
                className={`px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all ${
                  activeProgramId === Number(pId)
                    ? "bg-white text-blue-600 shadow-md scale-105"
                    : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
                }`}
              >
                {/* 🟢 ดึงชื่อจาก data.info แทนการดึงจาก PLO ตัวแรก */}
                {lang === "th"
                  ? data.info?.program_shortname_th ||
                    data.info?.program?.program_shortname_th
                  : data.info?.program_shortname_en ||
                    data.info?.program?.program_shortname_en}

                <span className="ml-2 opacity-50">
                  ({data.info?.program_year || data.info?.program?.program_year}
                  )
                </span>
              </button>
            ))}
          </div>
        )}

        {/* --- 2. The Matrix Table --- */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl overflow-hidden min-h-[400px]">
          <div className="overflow-x-auto custom-scrollbar">
            {masterCourseId && clos.length > 0 && filteredPlos.length > 0 ? (
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    {/* Diagonal Header */}
                    <th className="sticky left-0 top-0 z-50 bg-slate-50 border-b border-r border-slate-200 w-[120px] h-[70px]">
                      <div className="relative w-full h-full">
                        {/* SVG Line เดิมของคุณ */}
                        <div className="absolute top-3 right-4 text-[10px] font-black text-slate-500">
                          PLO
                        </div>
                        <div className="absolute bottom-3 left-4 text-[10px] font-black text-slate-500">
                          CLO
                        </div>
                      </div>
                    </th>

                    {/* PLO Columns - 🟢 ใช้ filteredPlos */}
                    {filteredPlos.map((plo) => (
                      <th
                        key={plo.id}
                        className="sticky top-0 z-40 border-b border-r border-slate-100 p-5 min-w-[100px] bg-slate-50/80 backdrop-blur-sm text-center"
                      >
                        <span className="text-sm font-black text-blue-600 uppercase">
                          {plo.code}
                        </span>
                      </th>
                    ))}

                    {/* Total Column Header */}
                    <th className="sticky top-0 right-0 z-40 border-b border-slate-200 p-5 min-w-[110px] bg-slate-100 text-center text-[10px] font-black text-slate-600 uppercase tracking-widest shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.05)]">
                      {t("Weight (%)")}
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-50">
                  {clos.map((clo) => {
                    // 🟢 แก้ไข: คำนวณ Total เฉพาะของ Program ที่เลือกอยู่
                    const currentProgramTotal = filteredPlos.reduce(
                      (sum, plo) => {
                        const key = `${clo.id}_${plo.id}_${activeProgramId}`;
                        return sum + (Number(mappingGrid[key]) || 0);
                      },
                      0,
                    );

                    const isTotalValid =
                      Math.abs(currentProgramTotal - 100) < 0.01;

                    return (
                      <tr
                        key={clo.id}
                        className="group hover:bg-slate-50/30 transition-colors"
                      >
                        <td className="sticky left-0 z-30 p-5 bg-white group-hover:bg-slate-50 border-r border-slate-100 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.05)] transition-colors">
                          <span className="text-sm font-black text-slate-700">
                            {clo.code}
                          </span>
                        </td>

                        {/* Weight Inputs - 🟢 ใช้ filteredPlos */}
                        {filteredPlos.map((plo) => {
                          const key = `${clo.id}_${plo.id}_${activeProgramId}_${semesterId}`;
                          const weight = mappingGrid[key] ?? "";
                          const hasValue = Number(weight) > 0;
                          const isChanged = changedKeys.has(key);

                          return (
                            <td
                              key={plo.id}
                              className={`p-1.5 border-r border-slate-50 text-center ${hasValue ? "bg-blue-50/20" : ""}`}
                            >
                              <input
                                type="text"
                                className={`w-full h-12 text-center text-lg font-black transition-all outline-none rounded-xl 
                            ${hasValue ? "text-blue-600" : "text-slate-200 focus:text-slate-600"}
                            ${isChanged ? "bg-amber-50 ring-2 ring-amber-200 text-amber-600" : "bg-transparent focus:bg-white focus:ring-4 focus:ring-slate-100"}
                          `}
                                placeholder="0"
                                value={
                                  weight !== "" ? Number(weight).toString() : ""
                                }
                                onChange={(e) =>
                                  handleWeightChange(
                                    clo.id,
                                    plo.id,
                                    activeProgramId!,
                                    e.target.value,
                                  )
                                }
                              />
                            </td>
                          );
                        })}

                        {/* Total Cell */}
                        <td
                          className={`sticky right-0 z-30 p-5 text-center shadow-[-4px_0_10px_-4px_rgba(0,0,0,0.05)] transition-all
                    ${isTotalValid ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}
                        >
                          <span className="text-sm font-black">
                            {currentProgramTotal}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
                {!masterCourseId ? (
                  <div className="space-y-4">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto border-2 border-dashed border-slate-200">
                      <Search className="text-slate-300" size={32} />
                    </div>
                    <p className="text-slate-400 font-bold uppercase text-[11px] tracking-[0.2em]">
                      {t("select_course_section")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 text-rose-400">
                    <AlertCircle size={48} className="mx-auto opacity-50" />
                    <p className="font-black uppercase text-[11px] tracking-widest">
                      {clos.length === 0
                        ? t("no_clos_found")
                        : t("no_plos_found")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Error - 🟢 เช็ค Error เฉพาะโปรแกรมที่เลือกอยู่เพื่อความชัดเจน */}
          {!isValidationSuccess && activeProgramId && (
            <div className="p-4 bg-rose-600 flex items-center justify-center gap-3">
              <AlertTriangle size={18} className="text-white" />
              <span className="text-[11px] font-black text-white uppercase tracking-widest">
                {t(
                  "please ensure row totals reach 100 percent for the current program",
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
