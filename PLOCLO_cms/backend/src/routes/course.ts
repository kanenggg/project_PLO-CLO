import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

const parseIntSafe = (value: any) => {
  if (!value) return undefined;
  const parsed = parseInt(String(value));
  return isNaN(parsed) ? undefined : parsed;
};

// POST / - สร้าง Master Course และจัดการ Semester/Section/Program
router.post("/", authenticateToken, async (req: Request, res: Response) => {
  const {
    code,
    name,
    name_th,
    credits,
    faculty_id,
    program_id,
    section,
    semester,
    year,
  } = req.body;

  if (!code || !name || !faculty_id) {
    return res.status(400).json({
      error: "Missing master course identity (code, name, faculty_id)",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Manage Master Course (ยึดตาม Code และ Faculty เจ้าของวิชา)
      let masterCourse = await tx.course.findFirst({
        where: { code, faculty_id: Number(faculty_id) },
      });

      if (!masterCourse) {
        masterCourse = await tx.course.create({
          data: {
            code,
            name,
            name_th: name_th || name,
            credits: parseFloat(credits) || 3,
            faculty_id: Number(faculty_id),
          },
        });
      }

      // 2. ถ้ามีการส่งข้อมูลการเปิดสอนมาด้วย (Year, Semester, Section)
      if (year && semester && section) {
        // --- STEP A: Manage Course Semester ---
        const courseSemester = await tx.courseSemester.upsert({
          where: {
            course_id_semester_year: {
              course_id: masterCourse.id,
              semester: Number(semester),
              year: Number(year),
            },
          },
          update: {},
          create: {
            course_id: masterCourse.id,
            semester: Number(semester),
            year: Number(year),
          },
        });

        // --- STEP B: Link Program to Semester (แทนการ Link กับ Course) ---
        if (program_id) {
          await tx.programOnCourse.upsert({
            where: {
              program_id_semester_id: {
                // 🟢 เปลี่ยนมาใช้ Composite Key ชุดใหม่
                program_id: Number(program_id),
                semester_id: courseSemester.id,
              },
            },
            update: {},
            create: {
              program_id: Number(program_id),
              semester_id: courseSemester.id,
              type: "core",
            },
          });
        }

        // --- STEP C: Manage Section ---
        const existingSection = await tx.courseSection.findFirst({
          where: {
            course_semester_id: courseSemester.id,
            section: Number(section),
          },
        });

        if (!existingSection) {
          await tx.courseSection.create({
            data: {
              course_semester_id: courseSemester.id,
              section: Number(section),
            },
          });
        }
      }

      return masterCourse;
    });

    res
      .status(201)
      .json({ message: "Hierarchy created successfully", data: result });
  } catch (err: any) {
    console.error("Post Course Error:", err);
    res.status(400).json({ error: err.message });
  }
});

// GET /paginate - กรองข้อมูลข้าม Program (ผ่าน Semester) และ Faculty
router.get(
  "/paginate",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const programCode = req.query.programCode as string | undefined;
      const universityId = parseIntSafe(req.query.universityId) || undefined;
      const facultyId = parseIntSafe(req.query.facultyId) || undefined;
      const year = parseIntSafe(req.query.year) || undefined;
      const semester = parseIntSafe(req.query.semester) || undefined;
      const section = parseIntSafe(req.query.section) || undefined;
      const courseSearch = req.query.courseCode as string | undefined;

      const page = parseIntSafe(req.query.page) || 1;
      const limit = parseIntSafe(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const where: any = {
        section: section || undefined,
        semester_config: {
          semester: semester || undefined,
          year: year || undefined,
          // 🟢 กรองผ่าน Program ที่ผูกกับ Semester_config
          programs:
            programCode || universityId
              ? {
                  some: {
                    program: {
                      program_code: programCode || undefined,
                      faculty: universityId
                        ? { university_id: universityId }
                        : undefined,
                    },
                  },
                }
              : undefined,
          course: {
            faculty_id: facultyId || undefined,
            OR: courseSearch
              ? [
                  { code: { contains: courseSearch, mode: "insensitive" } },
                  { name: { contains: courseSearch, mode: "insensitive" } },
                ]
              : undefined,
          },
        },
      };

      const [total, sections] = await prisma.$transaction([
        prisma.courseSection.count({ where }),
        prisma.courseSection.findMany({
          where,
          include: {
            semester_config: {
              include: {
                course: true,
                programOnCourses: { include: { program: true } }, // ดึงรายการหลักสูตรที่ผูกกับเทอมนี้
              },
            },
          },
          orderBy: [{ semester_config: { year: "desc" } }, { section: "asc" }],
          skip,
          take: limit,
        }),
      ]);

      res.json({
        data: sections.map((s) => ({
          id: s.id,
          code: s.semester_config.course.code,
          name: s.semester_config.course.name,
          name_th: s.semester_config.course.name_th,
          credits: s.semester_config.course.credits,
          section: s.section,
          semester: s.semester_config.semester,
          year: s.semester_config.year,
          faculty_id: s.semester_config.course.faculty_id,
          semester_id: s.semester_config.id,

          // ดึง program_code จากความสัมพันธ์ที่ผูกกับ semester
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error("Pagination Error:", err);
      res.status(500).json({ error: "Pagination failed" });
    }
  },
);

router.get(
  "/paginate/ByProgram",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const universityId = parseIntSafe(req.query.universityId);
      const facultyId = parseIntSafe(req.query.facultyId);
      const programId = parseIntSafe(req.query.programId);
      const programCode = req.query.programCode as string;

      const page = parseIntSafe(req.query.page) || 1;
      const limit = parseIntSafe(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      let targetProgramCode = programCode;

      // 1. ถ้าส่ง programId มา ให้ไปหา program_code ในตาราง Program
      if (programId && !targetProgramCode) {
        const prog = await prisma.program.findUnique({
          where: { id: programId },
          select: { program_code: true },
        });
        if (prog) targetProgramCode = prog.program_code;
      }

      // --- กรณีที่ 1: กรองตามหลักสูตร (ใช้ Program Code เพื่อหาทุก Program ID ที่เกี่ยวข้อง) ---
      if (targetProgramCode) {
        const where: Prisma.ProgramOnCourseWhereInput = {
          program: {
            program_code: targetProgramCode,
          },
          // คุณสามารถเพิ่ม type: "core" ตรงนี้ได้ถ้าต้องการกรองเฉพาะวิชาบังคับในหลักสูตร
          // type: "core"
        };

        const [total, items] = await prisma.$transaction([
          prisma.programOnCourse.count({ where }),
          prisma.programOnCourse.findMany({
            where,
            include: {
              program: true,
              semester: { include: { course: true } },
            },
            skip,
            take: limit,
            orderBy: [
              { program: { program_year: "desc" } },
              { semester: { year: "asc" } },
              { semester: { semester: "asc" } },
            ],
          }),
        ]);

        return res.json({
          data: items.map((item) => ({
            semester_id: item.semester_id,
            program_id: item.program_id,
            program_name: item.program.program_name_en,
            program_year: item.program.program_year,
            course_id: item.semester.course.id,
            code: item.semester.course.code,
            name: item.semester.course.name,
            name_th: item.semester.course.name_th,
            credits: item.semester.course.credits,
            year: item.semester.year,
            semester: item.semester.semester,
            type: item.type, // คืนค่า type ตามจริงที่เก็บใน DB (core/elective/etc.)
          })),
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        });
      }

      // --- กรณีที่ 2: ไม่ระบุหลักสูตร (ดึงจาก Master Course และ Default Type เป็น core) ---
      const courseWhere: Prisma.CourseWhereInput = {
        faculty:
          facultyId || universityId
            ? {
                id: facultyId || undefined,
                university_id: universityId || undefined,
              }
            : undefined,
      };

      const [total, courses] = await prisma.$transaction([
        prisma.course.count({ where: courseWhere }),
        prisma.course.findMany({
          where: courseWhere,
          skip,
          take: limit,
          orderBy: { code: "asc" },
        }),
      ]);

      return res.json({
        data: courses.map((c) => ({
          course_id: c.id,
          code: c.code,
          name: c.name,
          name_th: c.name_th,
          credits: c.credits,
          year: null,
          semester: null,
          program_id: null,
          // 🟢 กำหนดเป็น "core" ตามที่คุณต้องการเมื่อเป็นการดึงจากตารางหลัก
          type: "core",
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error("Fetch Error:", err);
      res.status(500).json({ error: "Failed to fetch courses" });
    }
  },
);

router.delete(
  "/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid course section ID" });
    }

    try {
      await prisma.courseSection.delete({ where: { id } });
      res.json({ message: "Course section deleted successfully" });
    } catch (err) {
      console.error("Delete Course Section Error:", err);
      res.status(500).json({ error: "Failed to delete course section" });
    }
  },
);

export default router;
