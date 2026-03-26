import { Student } from "@/utils/studentApi";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { apiClient } from "@/utils/apiClient";
import { useGlobalToast } from "@/app/context/ToastContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { Save } from "lucide-react";
import * as XLSX from "xlsx";
import { useTranslation } from "next-i18next";

interface Assignment {
  id: number;
  section_id: number;
  name: string;
  maxScore: number;
  weight: number;
  category: string;
}

interface ExcelScoreRow {
  "Student Code": string | number;
  "Student Name"?: string; // Optional, used for human verification
  [assignmentName: string]: string | number | undefined; // Dynamic keys for assignment names
}

interface StudentScore {
  student_id: number;
  section_id: number;
  assignment_id: number;
  score: number;
}

export default function ScoreMapping({
  semesterId,
  sectionId,
}: {
  semesterId: string | number;
  sectionId?: string | number;
}) {
  const { token } = useAuth();
  const { showToast } = useGlobalToast();
  const { t } = useTranslation("common");

  const [students, setStudents] = useState<Student[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [scoreGrid, setScoreGrid] = useState<
    Record<string, number | undefined>
  >({});

  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [studentRes, assignRes, scoreRes] = await Promise.all([
          apiClient.get(`/studentOnCourse?sectionId=${sectionId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          apiClient.get(`/assignment?semesterId=${semesterId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          apiClient.get(`/score?sectionId=${sectionId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        setStudents(studentRes.data);
        setAssignments(assignRes.data);

        const grid: Record<string, number> = {};
        if (Array.isArray(scoreRes.data)) {
          scoreRes.data.forEach((s: StudentScore) => {
            grid[`${s.student_id}_${s.assignment_id}`] = s.score;
          });
        }
        setScoreGrid(grid);
        setChangedKeys(new Set());
      } catch (err) {
        console.error(err);
        showToast("Failed to load data", "error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [semesterId, sectionId, token]);

  const sortedAssignments = useMemo(() => {
    // 1. กำหนดลำดับความสำคัญของหมวดหมู่ (Category)
    const categoryOrder: Record<string, number> = {
      presentation: 1,
      assignment: 2,
      midtermExam: 3,
      finalExam: 4,
      project: 5,
      quiz: 6,
    };

    // 2. ลำดับ Keyword ในชื่อ (กรณี Category เหมือนกัน แต่อยากเช็ค Keyword ในชื่อต่อ)
    const keywordOrder = [
      "presentation",
      "assignment",
      "midterm",
      "final",
      "project",
      "quiz",
    ];

    const getKeywordScore = (name: string) => {
      const lowerName = name.toLowerCase();
      const index = keywordOrder.findIndex((keyword) =>
        lowerName.includes(keyword),
      );
      return index === -1 ? 999 : index;
    };

    // 3. แปลงเลขโรมันเป็นตัวเลขเพื่อให้เรียงลำดับได้ถูกต้อง
    const romanMap: Record<string, number> = {
      i: 1,
      ii: 2,
      iii: 3,
      iv: 4,
      v: 5,
      vi: 6,
      vii: 7,
      viii: 8,
      ix: 9,
      x: 10,
      xi: 11,
      xii: 12,
    };

    const normalizeName = (name: string) => {
      return name
        .toLowerCase()
        .replace(/\b(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/g, (match) => {
          // ใช้ padStart(2, '0') เพื่อให้ "10" เรียงต่อจาก "09" ได้ถูกต้อง
          return romanMap[match].toString().padStart(2, "0");
        });
    };

    // 4. เริ่มการเรียงลำดับแบบหลายชั้น
    return [...assignments].sort((a, b) => {
      // ชั้นที่ 1: เรียงตาม Category (เช่น Presentation ขึ้นก่อน Assignment)
      const catA = categoryOrder[a.category] || 99;
      const catB = categoryOrder[b.category] || 99;
      if (catA !== catB) return catA - catB;

      // ชั้นที่ 2: เรียงตาม Keyword ที่ปรากฏในชื่อ (ถ้ามี)
      const scoreA = getKeywordScore(a.name);
      const scoreB = getKeywordScore(b.name);
      if (scoreA !== scoreB) return scoreA - scoreB;

      // ชั้นที่ 3: เรียงตามชื่อแบบ Natural Sort (รองรับทั้งตัวเลขและเลขโรมัน)
      const normA = normalizeName(a.name);
      const normB = normalizeName(b.name);
      return normA.localeCompare(normB, undefined, { numeric: true });
    });
  }, [assignments]);

  const handleScoreChange = (
    studentId: number,
    assignId: number,
    val: string,
    maxScore: number,
  ) => {
    // 🟢 FIX: Define the key here (combining studentId and assignId)
    const key = `${studentId}_${assignId}`;

    if (val !== "" && isNaN(Number(val))) return;

    if (val !== "" && Number(val) > maxScore) {
      showToast(`Score cannot exceed ${Number(maxScore).toFixed(2)}`, "error");
      return;
    }

    setScoreGrid((prev) => ({
      ...prev,
      [key]: val === "" ? undefined : Number(val),
    }));

    setChangedKeys((prev) => new Set(prev).add(key));
  };

  const handleSave = async () => {
    if (!token || changedKeys.size === 0) return;

    setLoading(true);

    // 🟢 ดึงข้อมูลการอัปเดต โดยแนบ sectionId เข้าไปด้วย
    const updates = Array.from(changedKeys).map((key) => {
      const [studentId, assignId] = key.split("_");
      return {
        student_id: Number(studentId),
        assignment_id: Number(assignId),
        score: scoreGrid[key] ?? 0,
        section_id: Number(sectionId), // 👈 เพิ่มฟิลด์นี้เพื่อให้ Backend นำไปสร้าง/อัปเดต
      };
    });

    try {
      await apiClient.post(
        "/score", // แก้ไข URL ตามที่คุณตั้งค่าไว้ใน Backend
        { updates, sectionId: Number(sectionId) }, // แนบไปทั้งในรายตัวและเป็นส่วนกลาง
        { headers: { Authorization: `Bearer ${token}` } },
      );

      showToast("Scores saved successfully!", "success");
      setChangedKeys(new Set()); // ล้างรายการที่เปลี่ยนแปลง
    } catch (err) {
      console.error("Save error:", err);
      showToast("Failed to save scores", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<ExcelScoreRow>(sheet);

      const newGrid = { ...scoreGrid };
      const newChangedKeys = new Set(changedKeys);
      let importCount = 0;
      let skipCount = 0;

      jsonData.forEach((row) => {
        // 1. ค้นหานิสิต: ใช้ trim() เพื่อตัดช่องว่างที่อาจติดมาใน Excel
        const excelStudentCode = String(
          row["student_code"] || row["Student Code"] || "",
        ).trim();

        const student = students.find(
          (s) => String(s.student_code).trim() === excelStudentCode,
        );

        if (!student) return;
        const studentId = student.student_id || student.id;

        Object.keys(row).forEach((columnName) => {
          // 2. ค้นหา Assignment: เปรียบเทียบแบบ Case-Insensitive และตัดช่องว่าง
          const assignment = assignments.find(
            (a) =>
              a.name.toLowerCase().trim() === columnName.toLowerCase().trim(),
          );

          if (assignment) {
            const scoreValue = row[columnName];
            const numericScore =
              scoreValue === "" || scoreValue === null
                ? undefined
                : Number(scoreValue);

            if (
              numericScore !== undefined &&
              !isNaN(numericScore) &&
              numericScore <= assignment.maxScore
            ) {
              const key = `${studentId}_${assignment.id}`;

              // 3. ตรวจสอบค่าเดิม: ใช้ Number() เพื่อให้แน่ใจว่าเป็นตัวเลขทั้งคู่ก่อนเทียบ
              const existingScore =
                newGrid[key] !== undefined ? Number(newGrid[key]) : undefined;

              if (existingScore !== numericScore) {
                newGrid[key] = numericScore;
                newChangedKeys.add(key);
                importCount++;
              } else {
                skipCount++;
              }
            }
          }
        });
      });

      setScoreGrid(newGrid);
      setChangedKeys(newChangedKeys);

      if (importCount > 0) {
        showToast(
          `นำเข้าข้อมูลใหม่/อัปเดต ${importCount} รายการ (ข้ามข้อมูลที่เหมือนเดิม ${skipCount} รายการ)`,
          "success",
        );
      } else {
        showToast("ไม่พบข้อมูลที่มีการเปลี่ยนแปลงในไฟล์ Excel", "error");
      }

      e.target.value = "";
    };
    reader.readAsArrayBuffer(file);
  };

  // ... ส่วนของ Logic เดิมของคุณ ...

  return (
    <div>
      {/* <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl overflow-hidden mt-8 relative min-h-[500px]"> */}
      {loading && <LoadingOverlay />}

      {/* Header Actions */}
      <div className="p-8 border-b border-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-50/50 gap-4">
        <div>
          <h3 className="font-black text-slate-800 uppercase text-xs tracking-[0.2em] mb-1">
            {t("Student Grade Mapping")}
          </h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Enter or import scores for this section
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <input
            type="file"
            id="excel-upload"
            className="hidden"
            accept=".xlsx, .xls"
            onChange={handleExcelImport}
          />

          <label
            htmlFor="excel-upload"
            className="flex-1 md:flex-none px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white border border-emerald-100 cursor-pointer active:scale-95"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Import Excel
          </label>

          <button
            onClick={handleSave}
            disabled={loading || changedKeys.size === 0}
            className={`flex-1 md:flex-none px-8 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-xl ${
              changedKeys.size === 0
                ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                : "bg-slate-900 text-white hover:bg-blue-600 shadow-slate-200 active:scale-95"
            }`}
          >
            <Save size={18} />
            Save Changes ({changedKeys.size})
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-separate border-spacing-0">
          <thead className="bg-slate-50/90 backdrop-blur-sm">
            <tr className="bg-slate-50/80">
              {/* 1. Sticky Header: Student ID */}
              <th className="p-4 sticky left-0 bg-slate-100 z-50 border-b-2 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                {/* 🟢 ขยายตัวอักษรเป็น text-[13px] และ font-black */}
                <div className="w-[120px] text-[13px] font-black text-slate-500 uppercase tracking-widest text-center">
                  {t("Student ID")}
                </div>
              </th>

              {/* 2. Sticky Header: Full Name */}
              {/* 🟢 แก้ไข: ใช้ left-[153px] (คำนวณจากความกว้างจริงของคอลัมน์แรก) */}
              <th className="p-4 sticky left-[153px] bg-slate-100 z-50 border-b-2 border-r border-slate-200 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.15)]">
                <div className="w-[200px] text-[13px] font-black text-slate-500 uppercase tracking-widest text-left px-2">
                  {t("Full Name")}
                </div>
              </th>

              {/* 3. Dynamic Assignment Headers */}
              {sortedAssignments.map((assign, index) => (
                <th
                  key={assign.id}
                  className="p-4 border-b-2 border-r border-slate-200 text-center min-w-[150px] bg-slate-50/50"
                >
                  <div className="flex flex-col items-center gap-1">
                    {/* 🟢 ชื่อ Assignment ใหญ่ขึ้นเป็น text-[14px] */}
                    <span className="text-[14px] font-black text-slate-800 leading-tight">
                      {assign.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-600 text-[10px] font-black">
                        #{index + 1}
                      </span>
                      <span className="text-[10px] font-black text-rose-500 uppercase tracking-tighter">
                        Limit: {Number(assign.maxScore).toFixed(1)}
                      </span>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-50">
            {students.length > 0 ? (
              students.map((student) => {
                const sId = student.student_id || student.id || 0;
                return (
                  <tr
                    key={sId}
                    className="group hover:bg-slate-100 transition-colors"
                  >
                    {/* 1. คอลัมน์รหัสนิสิต (Sticky) */}
                    <td className="p-5 sticky left-0 bg-white group-hover:bg-slate-50 transition-colors z-20 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      <div className="flex flex-col w-[120px]">
                        <span className="text-sm font-light text-slate-500 tracking-tight">
                          {student.student_code}
                        </span>
                      </div>
                    </td>

                    {/* 2. คอลัมน์ชื่อ-นามสกุล (Sticky) */}
                    <td className="p-5 sticky left-[152px] bg-white group-hover:bg-slate-50 transition-colors z-20 border-r border-slate-100 shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]">
                      <div className="flex flex-col w-[220px]">
                        {/* 🟢 ปรับชื่อเป็น text-base (ใหญ่ขึ้น) และ font-black */}
                        <span className="text-base font-light text-slate-900 truncate">
                          {student.first_name} {student.last_name}
                        </span>
                      </div>
                    </td>

                    {/* Score Inputs */}
                    {sortedAssignments.map((assign) => {
                      const key = `${sId}_${assign.id}`;
                      const val = scoreGrid[key] ?? "";
                      const isChanged = changedKeys.has(key);

                      return (
                        <td
                          key={assign.id}
                          className={`p-1 border-r border-slate-100 min-w-[120px] transition-colors ${
                            isChanged
                              ? "bg-amber-50 group-hover:bg-amber-100/50"
                              : "group-hover:bg-slate-100"
                          }`}
                        >
                          <input
                            type="text"
                            placeholder="-"
                            className={`w-full h-14 text-center text-lg font-black transition-all outline-none rounded-xl ${
                              isChanged
                                ? "bg-white text-amber-600 ring-2 ring-amber-200"
                                : val !== ""
                                  ? "bg-transparent text-blue-700 focus:bg-white focus:ring-4 focus:ring-blue-100"
                                  : "bg-transparent text-slate-300 focus:bg-white focus:ring-4 focus:ring-slate-100"
                            }`}
                            value={val}
                            onChange={(e) =>
                              handleScoreChange(
                                sId,
                                assign.id,
                                e.target.value,
                                assign.maxScore,
                              )
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={sortedAssignments.length + 2}
                  className="py-20 text-center"
                >
                  <div className="flex flex-col items-center opacity-20">
                    <svg
                      className="w-16 h-16 mb-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                      />
                    </svg>
                    <p className="text-sm font-black uppercase tracking-widest">
                      No students found
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Hint */}
      <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">
          * Scores are saved locally until you click &quot;Save Changes&quot;
        </p>
      </div>
    </div>
  );
}
