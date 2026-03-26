import { apiClient } from "./apiClient";

export interface Course {
  id: number;
  code: string;
  name: string;
  name_th: string;
  credits: number;
  faculty_id: number | string;
  program_id: number | string;
  semester_id: number | string;
  year: number | string;
  semester: number | string;
  section: number | string;
}

export async function addCourse(
  data: {
    code: string;
    name: string;
    name_th?: string;
    credits?: number;
    faculty_id: string | number; // ยอมรับทั้งคู่
    year?: string | number; // 🟢 ปรับให้รับ string | number
    semester?: string | number; // 🟢 ปรับให้รับ string | number
    section?: string | number; // 🟢 ปรับให้รับ string | number
    program_id?: string | number;
  },
  token: string,
) {
  // แปลงค่าที่เป็นตัวเลขให้ชัวร์ก่อนส่ง API
  const payload = {
    ...data,
    faculty_id: Number(data.faculty_id),
    year: data.year ? Number(data.year) : undefined,
    semester: data.semester ? Number(data.semester) : undefined,
    section: data.section ? Number(data.section) : undefined,
    credits: data.credits ? Number(data.credits) : 3,
  };

  const res = await apiClient.post("/course", payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export async function getCoursePaginate(
  token: string,
  page = 1,
  limit = 10,
  filters: Record<string, unknown> = {},
) {
  const res = await apiClient.get("/course/paginate/ByProgram", {
    headers: { Authorization: `Bearer ${token}` },
    params: { page, limit, ...filters },
  });
  return res.data;
}

export async function getCoursePaginateCode(
  token: string,
  page = 1,
  limit = 10,
  filters: Record<string, unknown> = {},
) {
  const res = await apiClient.get("/course/paginate", {
    headers: { Authorization: `Bearer ${token}` },
    params: { page, limit, ...filters },
  });
  return res.data;
}