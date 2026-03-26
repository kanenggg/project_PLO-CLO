"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useGlobalToast } from "@/app/context/ToastContext";
import { apiClient } from "../../utils/apiClient";
import LoadingOverlay from "@/components/LoadingOverlay";
import FormEditPopup from "@/components/EditPopup";
import AlertPopup from "@/components/AlertPopup";
import DropdownSelect from "@/components/DropdownSelect";
import { Calculator, RefreshCcw, Trash2, Edit3, Upload } from "lucide-react";
import * as XLSX from "xlsx";

interface Assignment {
  id: number;
  name: string;
  category: string;
  maxScore: number;
  weight: number;
  createdAt: string;
}

interface CategoryWeight {
  category: string;
  maxWeight: number;
}

interface ExcelRow {
  student_id?: string | number;
  student_code?: string | number;
  รหัสนิสิต?: string | number; // 🟢 รองรับคอลัมน์ภาษาไทย
  first_name?: string;
  last_name?: string;
  ชื่อ?: string;
  นามสกุล?: string;
  [key: string]: string | number | undefined; // 🟢 จำกัด type แทนการใช้ any
}

export default function AssignmentMapping({
  semesterId, // 🟢 เปลี่ยนจาก sectionId เป็น semesterId
}: {
  semesterId: string | number;
}) {
  const { token } = useAuth();
  const { showToast } = useGlobalToast();
  const { t } = useTranslation("common");

  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [categoryConfigs, setCategoryConfigs] = useState<CategoryWeight[]>([]);

  const [newAssignName, setNewAssignName] = useState("");
  const [newAssignCategory, setNewAssignCategory] = useState<string | number>(
    "",
  );
  const [newAssignMaxScore, setNewAssignMaxScore] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState("all");

  const [showEditPopup, setShowEditPopup] = useState(false);
  const [editFormData, setEditFormData] = useState<Assignment | null>(null);
  const [showDeletePopup, setShowDeletePopup] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<number | null>(
    null,
  );

  // --- 1. Fetch Data ---
  const fetchData = useCallback(async () => {
    if (!semesterId || !token) return; // 🟢 ตรวจสอบ semesterId
    setLoading(true);
    try {
      const config = {
        headers: { Authorization: `Bearer ${token}` },
        params: { semesterId }, // 🟢 ส่งเป็น semesterId ไปยัง Backend
      };

      const [assignRes, configRes] = await Promise.all([
        apiClient.get(`/assignment`, config), // Backend จะกรองด้วย semesterId จาก query
        apiClient.get("/assignment/categoriesWeights", config),
      ]);

      setAssignments(assignRes.data);
      setCategoryConfigs(configRes.data);
    } catch {
      showToast("Failed to fetch assignments", "error");
    } finally {
      setLoading(false);
    }
  }, [semesterId, token, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- 2. Weight Distribution Logic ---
  const handleRecalculateWeights = async (
    currentAssignments?: Assignment[],
  ) => {
    const listToProcess = currentAssignments || assignments;
    if (
      listToProcess.length === 0 ||
      categoryConfigs.length === 0 ||
      !semesterId
    )
      return;

    setLoading(true);
    try {
      const updates = listToProcess.map((assign) => {
        const config = categoryConfigs.find(
          (c) => c.category === assign.category,
        );
        if (!config) return { id: assign.id, weight: 0 };

        const totalMaxInCat = listToProcess
          .filter((a) => a.category === assign.category)
          .reduce((sum, a) => sum + Number(a.maxScore), 0);

        const calculatedWeight =
          totalMaxInCat > 0
            ? (Number(assign.maxScore) / totalMaxInCat) *
              Number(config.maxWeight)
            : 0;

        return {
          id: assign.id,
          weight: Number(calculatedWeight.toFixed(4)),
        };
      });

      // 🟢 แก้ไข: เปลี่ยน Endpoint ให้ตรงกับ Backend ใหม่
      await apiClient.patch(
        "/assignment/bulk-weights",
        {
          semesterId: Number(semesterId),
          updates,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      showToast("Weights auto-distributed successfully!", "success");
      await fetchData();
    } catch {
      showToast("Failed to sync weights", "error");
    } finally {
      setLoading(false);
    }
  };

  // --- 3. Handlers ---
  const handleAddAssignment = async () => {
    if (!newAssignName.trim() || !newAssignCategory || !newAssignMaxScore) {
      showToast("Please complete all fields", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.post(
        "/assignment",
        {
          semesterId: Number(semesterId), // 🟢 เปลี่ยนจาก section_id เป็น semesterId
          name: newAssignName.trim(),
          maxScore: Number(newAssignMaxScore),
          category: newAssignCategory,
          weight: 0,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      setNewAssignName("");
      setNewAssignMaxScore("");

      const updatedList = [...assignments, res.data];
      await handleRecalculateWeights(updatedList);
    } catch {
      showToast("Failed to add task", "error");
      setLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editFormData) return;
    setLoading(true);
    try {
      await apiClient.patch(
        `/assignment/${editFormData.id}`,
        {
          name: editFormData.name,
          maxScore: Number(editFormData.maxScore),
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      setShowEditPopup(false);
      await handleRecalculateWeights();
    } catch {
      showToast("Update failed", "error");
      setLoading(false);
    }
  };

  const handleDelete = async (id: number | null) => {
    if (!id) return;
    setLoading(true);
    try {
      await apiClient.delete(`/assignment/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setShowDeletePopup(false);
      const remaining = assignments.filter((a) => a.id !== id);
      await handleRecalculateWeights(remaining);
    } catch {
      showToast("Delete failed", "error");
      setLoading(false);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token || !semesterId) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        setLoading(true);
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws) as ExcelRow[];

        const payload = data
          .map((row) => ({
            name: String(
              row.name || row.Description || row.description || "",
            ).trim(),
            category: String(row.category || "assignment").trim(),
            maxScore: Number(row.maxScore || 100),
            description: String(row.description || "").trim(),
          }))
          .filter((item) => item.name !== ""); // กรองแถวว่างออก

        // 🟢 ส่งข้อมูลในโครงสร้าง { semesterId, assignments }
        await apiClient.post(
          "/assignment/bulk",
          {
            semesterId: Number(semesterId),
            assignments: payload,
          },
          { headers: { Authorization: `Bearer ${token}` } },
        );

        showToast(t("Import Success"), "success");
        await fetchData(); // โหลดข้อมูลใหม่มาแสดง
        await handleRecalculateWeights(); // กระจาย % น้ำหนักใหม่
      } catch {
        showToast("Failed to import excel", "error");
      } finally {
        setLoading(false);
        e.target.value = "";
      }
    };
    reader.readAsBinaryString(file);
  };

  // --- Sorting & Filtering ---
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

  return (
    <div className="max-w-7xl mx-auto p-2 space-y-6">
      {loading && <LoadingOverlay />}

      {/* --- DASHBOARD HEADER --- */}
      <div className="bg-slate-900 p-8 rounded-[3rem] text-white flex flex-col lg:flex-row justify-between items-center gap-6 shadow-2xl animate-in fade-in duration-500">
        <div className="flex items-center gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-[1.5rem] shadow-xl shadow-blue-500/20">
            <Calculator className="text-white w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight uppercase leading-none">
              Auto-Weight <span className="text-blue-400">Distribution</span>
            </h1>
            <p className="text-slate-400 text-[11px] mt-2 font-medium">
              Semester-wide proportional allocation based on boundary limits.
            </p>
          </div>
        </div>

        <div className="flex gap-3 w-full lg:w-auto">
          <label className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-6 py-3 rounded-2xl text-[10px] font-black tracking-widest cursor-pointer transition-all active:scale-95 group">
            <Upload
              size={14}
              className="group-hover:-translate-y-0.5 transition-transform"
            />
            IMPORT EXCEL
            <input
              type="file"
              className="hidden"
              accept=".xlsx, .xls"
              onChange={handleImportExcel}
            />
          </label>
          <button
            onClick={() => handleRecalculateWeights()}
            className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 px-8 py-3 rounded-2xl text-[10px] font-black tracking-widest transition-all shadow-lg active:scale-95 group"
          >
            <RefreshCcw
              size={14}
              className="group-hover:rotate-180 transition-transform duration-700"
            />
            SYNC WEIGHTS
          </button>
        </div>
      </div>

      {/* --- ADD FORM --- */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 items-end animate-in fade-in slide-in-from-top-4">
        <div className="flex-1 w-full">
          <label className="text-[10px] font-black text-slate-400 uppercase mb-2 block ml-1 tracking-widest">
            Category
          </label>
          <DropdownSelect
            options={categoryConfigs.map((c) => ({
              value: c.category,
              label: t(c.category),
            }))}
            value={newAssignCategory}
            onChange={setNewAssignCategory}
          />
        </div>
        <div className="flex-[2] w-full">
          <label className="text-[10px] font-black text-slate-400 uppercase mb-2 block ml-1 tracking-widest">
            Task Name
          </label>
          <input
            type="text"
            className="w-full h-[42px] border border-slate-200 px-4 rounded-xl outline-none focus:border-blue-400 transition-all font-bold text-slate-700"
            value={newAssignName}
            onChange={(e) => setNewAssignName(e.target.value)}
            placeholder="e.g. Midterm Quiz"
          />
        </div>
        <div className="w-full md:w-32">
          <label className="text-[10px] font-black text-slate-400 uppercase mb-2 block text-center tracking-widest">
            Max Score
          </label>
          <input
            type="number"
            className="w-full h-[42px] border border-slate-200 rounded-xl text-center font-black text-blue-600 focus:border-blue-400 outline-none"
            value={newAssignMaxScore}
            onChange={(e) => setNewAssignMaxScore(e.target.value)}
            placeholder="100"
          />
        </div>
        <button
          onClick={handleAddAssignment}
          className="w-full md:w-auto px-10 bg-slate-900 text-white font-black h-[42px] rounded-xl hover:bg-orange-600 transition-all shadow-lg active:scale-95"
        >
          + {t("Add")}
        </button>
      </div>

      {/* --- TABLE --- */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-xl overflow-hidden">
        <div className="p-6 bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap ${activeFilter === "all" ? "bg-slate-900 text-white" : "text-slate-400 hover:bg-slate-200"}`}
            >
              ALL
            </button>
            {categoryConfigs.map((c) => (
              <button
                key={c.category}
                onClick={() => setActiveFilter(c.category)}
                className={`px-5 py-2.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap ${activeFilter === c.category ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-200"}`}
              >
                {c.category.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full">
          <thead>
            <tr className="text-[10px] font-black uppercase text-slate-400 bg-slate-50/30">
              <th className="p-6 text-center w-20">#</th>
              <th className="p-6 text-left">Task Details</th>
              <th className="p-6 text-center">Base Max</th>
              <th className="p-6 text-center">Calculated Weight</th>
              <th className="p-6 text-right px-10">Manage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {sortedAssignments.map((a, idx) => (
              <tr
                key={a.id}
                className="group hover:bg-slate-50/80 transition-all"
              >
                <td className="p-6 text-center font-black text-slate-300 text-xs">
                  {idx + 1}
                </td>
                <td className="p-6">
                  <div className="font-bold text-slate-700">{a.name}</div>
                  <div className="text-[9px] font-black text-blue-500 uppercase tracking-widest mt-1">
                    {a.category}
                  </div>
                </td>
                <td className="p-6 text-center">
                  <span className="bg-slate-100 text-slate-600 px-4 py-1.5 rounded-lg font-black text-xs">
                    {a.maxScore}
                  </span>
                </td>
                <td className="p-6 text-center font-black text-slate-800">
                  {Number(a.weight).toFixed(2)}%
                </td>
                <td className="p-6 text-right px-10">
                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={() => {
                        setEditFormData(a);
                        setShowEditPopup(true);
                      }}
                      className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-xl shadow-sm transition-all"
                    >
                      <Edit3 size={18} />
                    </button>
                    <button
                      onClick={() => {
                        setAssignmentToDelete(a.id);
                        setShowDeletePopup(true);
                      }}
                      className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-xl shadow-sm transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- MODALS --- */}

      {showEditPopup && editFormData && (
        <FormEditPopup
          title="Adjust Assignment"
          data={editFormData}
          fields={[
            { label: "Task Name", key: "name", type: "text" },

            {
              label: "Max Score (Affects Proportional Weight)",

              key: "maxScore",

              type: "number",
            },
          ]}
          onSave={handleSaveEdit}
          onChange={setEditFormData}
          onClose={() => setShowEditPopup(false)}
        />
      )}

      <AlertPopup
        isOpen={showDeletePopup}
        type="confirm"
        title="Delete Assignment"
        message="This will permanently remove the task and redistribute the remaining weight for this category."
        onConfirm={() => handleDelete(assignmentToDelete)}
        onCancel={() => setShowDeletePopup(false)}
      />
    </div>
  );
}
