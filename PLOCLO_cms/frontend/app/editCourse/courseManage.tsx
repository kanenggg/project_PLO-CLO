"use client";

import { useTranslation } from "react-i18next";
import { useEffect, useState, useCallback, useMemo } from "react";
import AddButton from "@/components/AddButton";
import { Table, Column } from "@/components/Table";
import PaginationControlButton from "@/components/PaignateControlButton";
import { getFaculties, Faculty } from "@/utils/facultyApi";
import { getUniversities, University } from "@/utils/universityApi";
import { useGlobalToast } from "@/app/context/ToastContext";

import { addCourse, getCoursePaginate, Course } from "@/utils/courseApi";
import { useAuth } from "../context/AuthContext";
import { getPrograms, Program } from "@/utils/programApi";

import AlertPopup from "@/components/AlertPopup";
import { apiClient } from "@/utils/apiClient";

import LoadingOverlay from "@/components/LoadingOverlay";
import { useRouter } from "next/navigation";

interface CourseManagementProps {
  universityId?: string;
  facultyId?: string;
  programId?: string;
  year?: string;
  semester?: string;
  section?: string;
  course?: string;
  searchTerm?: string;
}

interface ExcelCourseRow {
  code?: string | number;
  Code?: string | number;
  course_id?: string | number;
  name_th?: string;
  course_name?: string;
  ชื่อไทย?: string;
  nameEn?: string;
  course_engname?: string;
  ชื่ออังกฤษ?: string;
  PLO_engname?: string;
  [key: string]: unknown;
}

interface Options {
  label: string;
  value: string;
}

export default function CourseManagement({
  universityId,
  facultyId,
  programId,
  searchTerm = "",
}: CourseManagementProps) {
  const { t, i18n } = useTranslation("common");
  const lang = i18n.language;
  const { token, isLoggedIn, initialized, user } = useAuth();
  const router = useRouter();
  const { showToast } = useGlobalToast();

  const isInstructor = user?.role === "instructor";

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoadingCourse] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 10;
  const [totalPages, setTotalPages] = useState(1);

  // --- Dropdown Options ---
  const [yearOptions, setYearOptions] = useState<Options[]>([]);
  const [programOptions, setProgramOptions] = useState<Options[]>([]);
  const [universityOptions, setUniversityOptions] = useState<Options[]>([]);
  const [facultyOptions, setFacultyOptions] = useState<Options[]>([]);

  // Static options
  const semesterOptions = [
    { label: t("Please select a semester"), value: "" },
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "Summer", value: "3" },
  ];
  const sectionOptions = [
    { label: t("Please select a section"), value: "" },
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "3", value: "3" },
    { label: "4", value: "4" },
  ];

  const [isInitialized, setIsInitialized] = useState(false);

  // --- Create/Add State (Local) ---
  const [selectedProgram, setSelectedProgram] = useState("");
  const [selectedUniversity, setSelectedUniversity] = useState("");
  const [selectedFaculty, setSelectedFaculty] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedSemester, setSelectedSemester] = useState("");
  const [selectedSection, setSelectedSection] = useState("");

  // --- Action State ---

  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [showDeletePopup, setShowDeletePopup] = useState(false);

  useEffect(() => {
    if (!token) return;
    const initialize = async () => {
      try {
        setLoadingCourse(true);
        const uniData = await getUniversities(token);
        const formattedUni = uniData.map((u: University) => ({
          label: lang === "th" ? u.name_th : u.name,
          value: String(u.id),
        }));

        const defaultUniOption = {
          label: t("please select a university"),
          value: "",
        };

        if (isInstructor && user?.email) {
          const instructorRes = await apiClient.get(
            `/instructor/email/${user.email}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          const fId = instructorRes.data?.faculty_id;
          const facultyRes = await apiClient.get(`/faculty/${fId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          const facultiesData = await getFaculties(
            token,
            String(facultyRes.data.university_id),
          );
          const formattedFacs = facultiesData.map((f: Faculty) => ({
            label: lang === "th" ? f.name_th : f.name,
            value: String(f.id),
          }));

          setUniversityOptions([defaultUniOption, ...formattedUni]);
          setFacultyOptions(formattedFacs);
          setSelectedUniversity(String(facultyRes.data.university_id));
          setSelectedFaculty(String(fId));
        } else {
          setUniversityOptions([defaultUniOption, ...formattedUni]);
        }
      } catch (err) {
        console.error("Initialization failed:", err);
      } finally {
        setIsInitialized(true);
        setLoadingCourse(false);
      }
    };
    initialize();
  }, [token, user?.email, user?.role, lang, t]);

  useEffect(() => {
    if (!token || !selectedUniversity || isInstructor || !isInitialized) {
      setFacultyOptions([{ label: t("please select a faculty"), value: "" }]);
      setSelectedFaculty("");
      return;
    }

    getFaculties(token, selectedUniversity)
      .then((data) => {
        const formatted = data.map((f: Faculty) => ({
          label: lang === "th" ? f.name_th : f.name,
          value: String(f.id),
        }));
        setFacultyOptions([
          { label: t("please select a faculty"), value: "" },
          ...formatted,
        ]);
      })
      .catch(() => setFacultyOptions([]));
  }, [selectedUniversity, isInitialized, lang, t]);

  // 3. Fetch Years (Derived from Programs in Faculty)
  useEffect(() => {
    if (!isLoggedIn || !token || !selectedFaculty) {
      setYearOptions([{ label: t("please select a year"), value: "" }]);
      setSelectedYear("");
      return;
    }

    getPrograms(token, selectedFaculty)
      .then((data) => {
        const years = Array.from(
          new Set<number>(data.map((p: Program) => Number(p.program_year))),
        ).sort((a, b) => b - a);

        if (years.length === 0) {
          setYearOptions([{ label: t("no years available"), value: "" }]);
        } else {
          setYearOptions([
            { label: t("please select a year"), value: "" },
            ...years.map((y) => {
              const label = lang === "en" ? String(y - 543) : String(y);
              return { label, value: String(y) };
            }),
          ]);
        }
      })
      .catch((err) => showToast("API program error: " + err.message, "error"));
  }, [isLoggedIn, token, selectedFaculty, t, lang, showToast]);

  // // 4. Fetch Programs (Filtered by Year)
  // useEffect(() => {
  //   if (!isLoggedIn || !token || !selectedFaculty || !selectedYear) {
  //     setProgramOptions([{ label: t("please select a program"), value: "" }]);
  //     setSelectedProgram("");
  //     return;
  //   }

  //   getPrograms(token, selectedFaculty)
  //     .then((data) => {
  //       const programs = data.filter(
  //         (p: Program) => String(p.program_year) === selectedYear,
  //       );

  //       if (programs.length === 0) {
  //         setProgramOptions([{ label: t("no programs available"), value: "" }]);
  //       } else {
  //         setProgramOptions([
  //           { label: t("please select a program"), value: "" },
  //           ...programs.map((p: Program) => ({
  //             label:
  //               lang === "th"
  //                 ? `${p.program_code} - ${p.program_shortname_th}`
  //                 : `${p.program_code} - ${p.program_shortname_en}`,
  //             value: String(p.id),
  //           })),
  //         ]);
  //       }
  //     })
  //     .catch((err: unknown) => {
  //       if (err instanceof Error) {
  //         showToast("API program error: " + err.message, "error");
  //       }
  //     });
  // }, [isLoggedIn, token, selectedFaculty, selectedYear, t, lang, showToast]);

  // --- Fetch List Logic ---
  const fetchCourses = useCallback(async () => {
    if (!isLoggedIn || !token) return;
    setLoadingCourse(true);
    try {
      const data = await getCoursePaginate(token, page, limit, {
        universityId,
        facultyId: facultyId || selectedFaculty,
        programCode: programId || selectedProgram,
      });
      setCourses(data.data || []);
    } catch {
      showToast("Error fetching courses", "error");
    } finally {
      setLoadingCourse(false);
    }
  }, [
    isLoggedIn,
    token,
    page,
    universityId,
    facultyId,
    selectedFaculty,
    programId,
    selectedProgram,
    showToast,
  ]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  // --- ADD COURSE Handlers ---

  const handleAddCourse = async (data: Record<string, unknown>) => {
    if (!token || !selectedProgram || !selectedFaculty) {
      showToast(t("Please fill all required fields"), "error");
      return;
    }

    setLoadingCourse(true);
    try {
      await addCourse(
        {
          code: String(data.code),
          name: String(data.nameEn),
          name_th: String(data.nameTh),
          faculty_id: Number(selectedFaculty), // 🟢 ระบุเจ้าของวิชา
          // program_id: Number(selectedProgram), // 🟢 ระบุหลักสูตรที่ใช้
          // year: Number(selectedYear),
          // semester: Number(selectedSemester),
          // section: Number(selectedSection),
          credits: 3,
        },
        token,
      );

      showToast(t("Course section added successfully!"), "success");
      fetchCourses();
    } catch (err: any) {
      showToast(
        err.response?.data?.error || t("Failed to add course"),
        "error",
      );
    } finally {
      setLoadingCourse(false);
    }
  };

  const handleAddCourseExcel = async (rows: ExcelCourseRow[]) => {
    if (!initialized || !isLoggedIn || !token) {
      showToast("Authentication error. Please log in.", "error");
      return;
    }

    // if (!selectedProgram || !selectedYear) {
    //   showToast(
    //     "Please select Program and Year from the dropdowns first.",
    //     "error",
    //   );
    //   return;
    // }

    let successCount = 0;
    let failCount = 0;
    const errorDetails: string[] = [];

    for (const [i, row] of rows.entries()) {
      const code = row.code || row.Code || row.course_id;
      const nameTh = row.nameTh || row.course_name || row["ชื่อไทย"];
      const nameEn =
        row.nameEn ||
        row.course_engname ||
        row["ชื่ออังกฤษ"] ||
        row.PLO_engname;

      if (!code || !nameTh || !nameEn) {
        failCount++;
        errorDetails.push(`Row ${i + 1}: Missing code or name.`);
        continue;
      }

      const payload = {
        code: String(code),
        name_th: String(nameTh),
        name: String(nameEn),
        // program_id: selectedProgram,
        faculty_id: selectedFaculty || "1", // Fallback to 1 if not selected
        year: selectedYear,
        semester: selectedSemester || "1",
        section: selectedSection || "1",
        credits: 3, // Default credits, adjust as needed
      };

      try {
        await addCourse(payload, token);
        successCount++;
      } catch (err: any) {
        failCount++;
        const backendMsg =
          err.response?.data?.error || err.message || "Unknown error";
        errorDetails.push(`Row ${i + 1} (${code}): ${backendMsg}`);
      }
    }

    let summary = `Success: ${successCount}, Failed: ${failCount}`;
    if (errorDetails.length > 0) {
      summary +=
        `\nErrors:\n` +
        errorDetails.slice(0, 3).join("\n") +
        (errorDetails.length > 3 ? "..." : "");
    }
    showToast(summary, failCount > 0 ? "error" : "success");

    if (successCount > 0) {
      fetchCourses();
      setPage(1);
    }
  };

  useEffect(() => {
    console.log(courses);
  });

  // --- Table Configuration ---
  const courseColumns: Column<Course>[] = [
    { header: t("course id"), accessor: "code" },
    {
      header: lang === "th" ? "ชื่อวิชา" : "Course Name",
      accessor: lang === "th" ? "name_th" : "name",
    },
    // {
    //   header: "Programs",
    //   accessor: "code",
    //   render: (row: any) => (
    //     <div className="flex gap-1 flex-wrap">
    //       {row.programs?.map((p: string) => (
    //         <span
    //           key={p}
    //           className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
    //         >
    //           {p}
    //         </span>
    //       ))}
    //     </div>
    //   ),
    // },
    {
      header: "Actions",
      accessor: "id",
      actions: [
        {
          label: t("view details"),
          color: "blue",
          onClick: (row: Course) => {
            router.push(`/editCourse/${row.code}`); // ไปจัดการ Sections ภายใต้รหัสนี้
          },
        },
      ],
    },
  ];

  const confirmDelete = async () => {
    if (!courseToDelete || !token) return;
    try {
      await apiClient.delete(`/course/${courseToDelete.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast(t("Course deleted successfully!"), "success");
      fetchCourses();
    } catch {
      showToast(t("Failed to delete course"), "error");
    } finally {
      setShowDeletePopup(false);
      setCourseToDelete(null);
    }
  };

  // const saveEdit = async () => {
  //   if (!selectedCourse || !token) return;
  //   try {
  //     await apiClient.patch(`/course/${selectedCourse.id}`, selectedCourse, {
  //       headers: { Authorization: `Bearer ${token}` },
  //     });
  //     showToast(t("Course updated successfully!"), "success");
  //     fetchCourses();
  //   } catch (err: any) {
  //     showToast(
  //       err.response?.data?.error || t("Failed to update course"),
  //       "error",
  //     );
  //   } finally {
  //     setShowEditPopup(false);
  //     setSelectedCourse(null);
  //   }
  // };

  const filteredCourses = useMemo(() => {
    const searched = courses.filter((course) => {
      const term = searchTerm.toLowerCase();
      return (
        course.name?.toLowerCase().includes(term) ||
        course.code?.toLowerCase().includes(term) ||
        course.name_th?.toLowerCase().includes(term)
      );
    });

    // Group by Code เพื่อไม่ให้วิชาเดิมโชว์ซ้ำหลายเซคชั่น
    const uniqueData = Array.from(
      new Map(searched.map((item) => [item.code, item])).values(),
    );

    setTotalPages(Math.ceil(uniqueData.length / limit) || 1);
    return uniqueData;
  }, [courses, searchTerm]);

  return (
    <div className="mt-5 p-5">
      {loading && <LoadingOverlay />}

      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-extralight">{t("course management")}</h1>
        <AddButton
          buttonText={t("create new course")}
          placeholderText={{
            code: "Course Id (value.g. CS101)",
            nameEn: "Course Name (EN)",
            nameTh: "Course Name (TH)",
          }}
          submitButtonText={{
            insert: "Insert Course Section",
            upload: "Upload Excel",
          }}
          disableUniversity={isInstructor}
          disableFaculty={isInstructor}
          showAbbreviationInputs={false}
          programOptions={programOptions}
          universityOptions={universityOptions}
          facultyOptions={facultyOptions}
          yearOptions={yearOptions}
          semesterOptions={semesterOptions}
          sectionOptions={sectionOptions}
          selectedProgram={selectedProgram}
          selectedFaculty={selectedFaculty}
          selectedUniversity={selectedUniversity}
          selectedYear={selectedYear}
          selectedSemester={selectedSemester}
          selectedSection={selectedSection}
          onUniversityChange={(value) => setSelectedUniversity(String(value))}
          onFacultyChange={(value) => setSelectedFaculty(String(value))}
          onProgramChange={(value) => setSelectedProgram(String(value))}
          onYearChange={(value) => setSelectedYear(String(value))}
          onSemesterChange={(value) => setSelectedSemester(String(value))}
          onSectionChange={(value) => setSelectedSection(String(value))}
          onSubmit={handleAddCourse}
          onSubmitExcel={handleAddCourseExcel}
        />
      </div>

      <div className="bg-white p-4 rounded-lg shadow-xl">
        {/* 🟢 PASS UNIQUE COURSES TO TABLE */}
        <Table<Course> columns={courseColumns} data={filteredCourses} />

        <div className="pt-4 flex justify-end">
          <PaginationControlButton
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      </div>

      <AlertPopup
        title="Delete Course Section"
        type="confirm"
        message={`Are you sure you want to delete ${courseToDelete?.code}?`}
        isOpen={showDeletePopup}
        onCancel={() => {
          setShowDeletePopup(false);
          setCourseToDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
