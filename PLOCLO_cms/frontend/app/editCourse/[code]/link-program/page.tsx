"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/context/AuthContext";
import { useGlobalToast } from "@/app/context/ToastContext";
import { getPrograms, Program } from "@/utils/programApi";
import { apiClient } from "@/utils/apiClient";
import DropdownSelect from "@/components/DropdownSelect";
import LoadingOverlay from "@/components/LoadingOverlay";
import {
  ChevronLeft,
  Link as LinkIcon,
  Info,
  CheckCircle2,
  X,
  PlusCircle,
  Trash2,
} from "lucide-react";
import AlertPopup from "@/components/AlertPopup";

interface SelectedProgramDraft {
  id: number;
  type: "core" | "elective";
  label: string;
}

interface ProgramOnCourse {
  id: number;
  type: "core" | "elective";
  program: {
    id: number;
    program_shortname_th: string;
    program_shortname_en: string;
    program_year: number;
  } | null;
}

export default function LinkProgramPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { t, i18n } = useTranslation("common");
  const lang = i18n.language;
  const { token } = useAuth();
  const { showToast } = useGlobalToast();

  const courseCode = params.code;
  const semesterId = searchParams.get("semesterId");
  const facultyId = searchParams.get("facultyId");

  const [allPrograms, setAllPrograms] = useState<Program[]>([]);
  const [programOnCourse, setProgramOnCourse] = useState<ProgramOnCourse[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<
    SelectedProgramDraft[]
  >([]);
  const [selectedProgramToDelete, setSelectedProgramToDelete] = useState<
    number | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [showAlert, setShowAlert] = useState(false);

  // 1. โหลดหลักสูตรทั้งหมดในคณะ
  useEffect(() => {
    if (token && facultyId) {
      getPrograms(token, String(facultyId))
        .then((data) => setAllPrograms(data))
        .catch(() => showToast(t("Failed to load programs"), "error"));
    }
  }, [token, facultyId, t, showToast]);

  // 2. โหลดหลักสูตรที่ถูกเชื่อมโยงไว้แล้ว
  const fetchProgramOnCourse = async () => {
    if (token && semesterId) {
      try {
        const res = await apiClient.get(
          `/programOnCourse?semester_id=${semesterId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        setProgramOnCourse(Array.isArray(res.data) ? res.data : []);
      } catch {
        showToast(t("Failed to load linked programs"), "error");
      }
    }
  };

  useEffect(() => {
    fetchProgramOnCourse();
  }, [token, semesterId]);

  // 3. กรองหลักสูตรใน Dropdown (ซ่อนตัวที่มีอยู่แล้วทั้งใน DB และใน Draft)
  const filteredOptions = useMemo(() => {
    const linkedIds = new Set(programOnCourse.map((item) => item.program?.id));
    const draftIds = new Set(selectedPrograms.map((p) => p.id));

    return allPrograms
      .filter((p) => !linkedIds.has(p.id) && !draftIds.has(p.id))
      .map((p) => ({
        label:
          lang === "th"
            ? `${p.program_shortname_th} (${p.program_year})`
            : `${p.program_shortname_en} (${p.program_year})`,
        value: String(p.id),
      }));
  }, [allPrograms, programOnCourse, selectedPrograms, lang]);

  // 4. จัดการรายการ Draft
  const addProgramToDraft = (id: string) => {
    const program = allPrograms.find((p) => String(p.id) === id);
    if (!program) return;

    const label =
      lang === "th"
        ? `${program.program_shortname_th} (${program.program_year})`
        : `${program.program_shortname_en} (${program.program_year})`;

    setSelectedPrograms((prev) => [
      ...prev,
      {
        id: Number(program.id), // 🟢 บังคับให้เป็น number ตรงนี้
        type: "core",
        label,
      },
    ]);
  };

  const updateDraftType = (id: number, type: "core" | "elective") => {
    setSelectedPrograms((prev) =>
      prev.map((p) => (p.id === id ? { ...p, type } : p)),
    );
  };

  const removeFromDraft = (id: number) => {
    setSelectedPrograms((prev) => prev.filter((p) => p.id !== id));
  };

  // 5. บันทึกข้อมูลแบบ Bulk
  const handleConfirm = async () => {
    if (!token || selectedPrograms.length === 0 || !semesterId) return;

    setLoading(true);
    try {
      await apiClient.post(
        "/programOnCourse",
        {
          updates: selectedPrograms.map((p) => ({
            program_id: p.id,
            semester_id: Number(semesterId),
            type: p.type,
          })),
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      setSelectedPrograms([]);
      fetchProgramOnCourse();
      showToast(t("Programs linked successfully"), "success");
    } catch (err: any) {
      showToast(
        err.response?.data?.error || t("Failed to link programs"),
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (pId: number) => {
    setLoading(true);
    try {
      await apiClient.delete("/programOnCourse", {
        data: { program_id: pId, semester_id: Number(semesterId) },
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast(t("Mapping deleted successfully"), "success");
      fetchProgramOnCourse();
    } catch {
      showToast(t("Failed to delete mapping"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      {loading && <LoadingOverlay />}

      <div className="max-w-3xl mx-auto mb-8">
        {/* Back Button */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 transition-colors mb-4 group"
        >
          <ChevronLeft
            size={20}
            className="group-hover:-translate-x-1 transition-transform"
          />
          <span className="text-sm font-bold uppercase tracking-wider">
            {t("Back to Course")}
          </span>
        </button>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
              <LinkIcon size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-800">
                {t("Enroll Program")}
              </h1>
              <p className="text-slate-500 text-sm">
                {t("Add curriculum to")}{" "}
                <span className="font-bold text-indigo-600">{courseCode}</span>
              </p>
            </div>
          </div>

          <hr className="border-slate-100 mb-8" />

          {/* Linked List Area */}
          {programOnCourse.length > 0 && (
            <div className="mb-8 p-5 bg-slate-50 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-widest mb-4">
                <CheckCircle2 size={16} />
                {t("Already linked programs")}
              </div>
              <div className="flex flex-wrap gap-2">
                {programOnCourse.map((item: ProgramOnCourse) => (
                  <div
                    key={item.program?.id}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-[11px] font-bold text-slate-500 rounded-xl"
                  >
                    <span>
                      {lang === "th"
                        ? `${item.program?.program_shortname_th} (${item.program?.program_year})`
                        : `${item.program?.program_shortname_en} (${item.program?.program_year})`}
                    </span>
                    <span className="px-1.5 py-0.5 bg-slate-100 rounded text-[9px] uppercase">
                      ({t(item.type)})
                    </span>
                    <button
                      onClick={() => {
                        setSelectedProgramToDelete(item.program.id);
                        setShowAlert(true);
                      }}
                      className="text-slate-300 hover:text-red-500 ml-1"
                    >
                      <X size={14} strokeWidth={3} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-8">
            {/* Selection Area */}
            <div className="p-6 bg-indigo-50/50 rounded-3xl border-2 border-dashed border-indigo-100">
              <label className="flex items-center gap-2 text-sm font-bold text-indigo-900 mb-4">
                <PlusCircle size={18} className="text-indigo-500" />
                {t("Add Programs to Enrollment")}
              </label>
              <DropdownSelect
                options={filteredOptions}
                value=""
                onChange={(val) => addProgramToDraft(String(val))}
              />
            </div>

            {/* Draft List Area */}
            {selectedPrograms.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">
                  {t("Pending Enrollment")}
                </p>
                {selectedPrograms.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white border border-indigo-200 rounded-2xl shadow-sm gap-4 transition-all hover:border-indigo-400"
                  >
                    <div className="font-bold text-slate-700 text-sm">
                      {p.label}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex bg-slate-100 p-1 rounded-xl">
                        {(["core", "elective"] as const).map((typeValue) => (
                          <button
                            key={typeValue}
                            // 🟢 ส่ง typeValue ("core" หรือ "elective") ตรงๆ ไปที่ฟังก์ชัน
                            onClick={() => updateDraftType(p.id, typeValue)}
                            className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all capitalize ${
                              p.type === typeValue
                                ? "bg-white text-indigo-600 shadow-sm"
                                : "text-slate-400 hover:text-slate-600"
                            }`}
                          >
                            {/* 🟢 ใช้ t() เฉพาะตอนที่จะ "แสดงผล" บนหน้าจอเท่านั้น */}
                            {t(typeValue)}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => removeFromDraft(p.id)}
                        className="text-slate-300 hover:text-red-500 p-1"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
              <Info className="text-amber-500 shrink-0" size={20} />
              <p className="text-xs text-amber-700 leading-relaxed">
                {t(
                  "Specify the subject category for each curriculum. This setting affects how CLO-PLO mappings are calculated for specific student groups.",
                )}
              </p>
            </div>

            <button
              onClick={handleConfirm}
              disabled={selectedPrograms.length === 0 || loading}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-2xl font-bold shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
            >
              {t("Confirm Enrollment")}{" "}
              {selectedPrograms.length > 0 && `(${selectedPrograms.length})`}
            </button>
          </div>
        </div>
      </div>

      {showAlert && (
        <AlertPopup
          title={t("Unlink Program")}
          type="confirm"
          isOpen={showAlert}
          message={t("Are you sure you want to unlink this program?")}
          onConfirm={() => {
            handleDelete(Number(selectedProgramToDelete));
            setShowAlert(false);
          }}
          onCancel={() => setShowAlert(false)}
        />
      )}
    </div>
  );
}
