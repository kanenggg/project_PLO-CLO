import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /: ดึงรายชื่อนักศึกษาตามเงื่อนไข
 * 1. courseId: ดึงทุกคนในวิชานี้ (ทุก Section ใน Semester เดียวกัน)
 * 2. sectionId: ดึงเฉพาะคนใน Section นั้น
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { sectionId, semesterId } = req.query; // 🟢 เปลี่ยนจาก courseId เป็น semesterId

    if (!sectionId && !semesterId) {
      return res
        .status(400)
        .json({ error: "Either sectionId or semesterId is required" });
    }

    // CASE A: ค้นหานิสิตที่ลงทะเบียนใน Semester นี้แล้ว (ทุก Section ภายใต้ Semester เดียวกัน)
    // ใช้สำหรับเช็ค Duplicate ในระดับเทอมก่อน Import Excel
    if (semesterId) {
      const students = await prisma.student.findMany({
        where: {
          sections: {
            some: {
              section: {
                course_semester_id: Number(semesterId), // 🟢 กรองเฉพาะนิสิตในเทอมที่ระบุเท่านั้น
              },
            },
          },
        },
        select: {
          id: true,
          student_code: true,
          first_name: true,
          last_name: true,
        },
      });
      return res.json(students);
    }

    // CASE B: ค้นหานิสิตเฉพาะใน Section ที่ระบุ
    if (sectionId) {
      const enrollments = await prisma.studentOnSection.findMany({
        where: { section_id: Number(sectionId) },
        include: {
          student: true,
          section: {
            include: {
              semester_config: {
                include: { course: true },
              },
            },
          },
        },
        orderBy: {
          student: { student_code: "asc" },
        },
      });

      return res.json(
        enrollments.map((e) => ({
          student_id: e.student_id,
          section_id: e.section_id,
          assignedAt: e.assignedAt,
          course_name: e.section.semester_config.course.name,
          course_code: e.section.semester_config.course.code,
          section: e.section.section,
          semester: e.section.semester_config.semester,
          year: e.section.semester_config.year,
          student_code: e.student.student_code,
          first_name: e.student.first_name,
          last_name: e.student.last_name,
        })),
      );
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch student records" });
  }
});

/**
 * POST /bulk: เพิ่มนักศึกษาเข้ากลุ่มเรียนแบบกลุ่ม
 */
router.post("/bulk", authenticateToken, async (req, res) => {
  const { sectionId, studentIds } = req.body;

  if (!sectionId || !Array.isArray(studentIds)) {
    return res.status(400).json({ error: "Invalid sectionId or studentIds" });
  }

  try {
    // 1. หาข้อมูล Semester ของ Section ปัจจุบัน
    const sectionInfo = await prisma.courseSection.findUnique({
      where: { id: Number(sectionId) },
      select: { course_semester_id: true },
    });

    if (!sectionInfo)
      return res.status(404).json({ error: "Section not found" });

    // 2. ตรวจสอบนิสิตที่ลงทะเบียนในวิชานี้ (เทอมนี้) ไปแล้ว
    const existing = await prisma.studentOnSection.findMany({
      where: {
        student_id: { in: studentIds.map((id) => Number(id)) },
        section: { course_semester_id: sectionInfo.course_semester_id },
      },
      select: { student_id: true },
    });

    const alreadyEnrolledIds = existing.map((e) => e.student_id);
    const studentsToAdd = studentIds
      .map((id) => Number(id))
      .filter((id) => !alreadyEnrolledIds.includes(id));

    if (studentsToAdd.length === 0) {
      return res.status(200).json({
        message: "All students are already enrolled in this semester.",
        skippedCount: alreadyEnrolledIds.length,
        addedCount: 0,
      });
    }

    // 3. บันทึกข้อมูลแบบ Bulk
    const created = await prisma.studentOnSection.createMany({
      data: studentsToAdd.map((id) => ({
        student_id: id,
        section_id: Number(sectionId),
      })),
      skipDuplicates: true,
    });

    res.json({
      message: `Successfully assigned ${created.count} students.`,
      skippedCount: alreadyEnrolledIds.length,
      addedCount: created.count,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to assign students" });
  }
});

router.delete("/bulk-delete", authenticateToken, async (req, res) => {
  const { sectionId, studentIds } = req.body;

  if (!sectionId || !Array.isArray(studentIds)) {
    return res.status(400).json({ error: "Invalid sectionId or studentIds" });
  }

  try {
    const deleted = await prisma.studentOnSection.deleteMany({
      where: {
        student_id: { in: studentIds.map((id) => Number(id)) },
        section_id: Number(sectionId),
      },
    });

    res.json({
      message: `Successfully removed ${deleted.count} students from the section.`,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove students" });
  }
});

export default router;
