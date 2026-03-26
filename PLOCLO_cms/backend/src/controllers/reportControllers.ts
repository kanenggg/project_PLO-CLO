import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 1. สรุปภาพรวมรายวิชา (รวมทุก Section ใน Semester เดียวกัน)
export const getGradeSummary = async (req: any, res: any) => {
  const { semesterId } = req.query;

  if (!semesterId)
    return res.status(400).json({ message: "Missing semesterId" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 🟢 ดึงข้อมูลพื้นฐานที่แชร์กันทั้งเทอม
      const [assignments, gradeSettings, semesterData] = await Promise.all([
        tx.assignment.findMany({ where: { semester_id: Number(semesterId) } }),
        tx.gradeSetting.findMany({
          where: { semester_id: Number(semesterId) },
          orderBy: { score: "desc" },
        }),
        tx.courseSemester.findUnique({
          where: { id: Number(semesterId) },
          include: {
            sections: {
              include: {
                students: {
                  include: {
                    student: {
                      include: {
                        scores: {
                          where: {
                            assignment: { semester_id: Number(semesterId) },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

      if (!semesterData) throw new Error("SEMESTER_NOT_FOUND");

      // คำนวณคะแนนเต็มรวมของแต่ละหมวดหมู่
      const categoryFullScores: Record<string, number> = {};
      assignments.forEach((assign) => {
        categoryFullScores[assign.category] = Number(
          (
            (categoryFullScores[assign.category] || 0) + Number(assign.weight)
          ).toFixed(4),
        );
      });

      // จัดการรวบรวมนักเรียนจากทุก Section
      const studentMap = new Map();
      semesterData.sections.forEach((sec) => {
        sec.students.forEach((rec) =>
          studentMap.set(rec.student.id, rec.student),
        );
      });

      const studentSummaries = Array.from(studentMap.values()).map(
        (student) => {
          let totalWeightedScore = 0;
          const categoryEarnedScores: Record<string, number> = {};

          assignments.forEach((assign) => {
            const scoreRec = student.scores.find(
              (s: any) => s.assignment_id === assign.id,
            );
            const raw = scoreRec ? Number(scoreRec.score) : 0;

            // สูตร: (คะแนนดิบ / คะแนนเต็มข้อ) * น้ำหนักข้อนั้น
            const weighted =
              (raw / Number(assign.maxScore)) * Number(assign.weight);

            totalWeightedScore += weighted;
            categoryEarnedScores[assign.category] = Number(
              ((categoryEarnedScores[assign.category] || 0) + weighted).toFixed(
                4,
              ),
            );
          });

          // 🟢 ตัดเกรดตามเกณฑ์ของ Semester นี้
          const grade =
            gradeSettings.find((g) => totalWeightedScore >= Number(g.score))
              ?.grade || "F";

          return {
            student_id: student.id,
            student_code: student.student_code,
            first_name: student.first_name,
            last_name: student.last_name,
            categoryEarnedScores,
            totalScore: Number(totalWeightedScore.toFixed(2)),
            grade,
          };
        },
      );

      return { categoryFullScores, students: studentSummaries };
    });

    return res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// 2. สรุปราย Section
export const getSectionGradeSummary = async (req: any, res: any) => {
  const { sectionId } = req.query;
  if (!sectionId) return res.status(400).json({ message: "Missing sectionId" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. ดึงข้อมูลพื้นฐานของ Section และ Assignment ก่อน
      const sectionInfo = await tx.courseSection.findUnique({
        where: { id: Number(sectionId) },
        include: {
          semester_config: {
            include: {
              assignments: true,
              gradeSettings: { orderBy: { score: "desc" } },
            },
          },
        },
      });

      if (!sectionInfo) throw new Error("SECTION_NOT_FOUND");

      // 2. 🟢 เปลี่ยนมาดึงจาก Table การลงทะเบียน (Enrollment Table) โดยตรง
      // เพื่อให้มั่นใจว่าได้เฉพาะรายชื่อนิสิตใน Section นี้เท่านั้น
      const enrollments = await tx.studentOnSection.findMany({
        where: { section_id: Number(sectionId) },
        include: {
          student: {
            include: {
              scores: {
                // ดึงเฉพาะคะแนนที่เกิดขึ้นใน Section นี้
                where: { section_id: Number(sectionId) },
              },
            },
          },
        },
      });

      const assignments = sectionInfo.semester_config.assignments;
      const gradeSettings = sectionInfo.semester_config.gradeSettings;

      // 3. คำนวณคะแนนจากรายการ Enrollment
      return enrollments.map((enroll) => {
        const student = enroll.student;
        let totalWeighted = 0;
        const categoryScores: Record<string, number> = {};

        assignments.forEach((assign) => {
          const scoreRec = student.scores.find(
            (s) => s.assignment_id === assign.id,
          );

          const rawScore = scoreRec ? Number(scoreRec.score) : 0;
          const weighted =
            (rawScore / Number(assign.maxScore)) * Number(assign.weight);

          categoryScores[assign.category] = Number(
            ((categoryScores[assign.category] || 0) + weighted).toFixed(4),
          );
          totalWeighted += weighted;
        });

        const finalGrade =
          gradeSettings.find((g) => totalWeighted >= Number(g.score))?.grade ||
          "F";

        return {
          student_id: student.id,
          student_code: student.student_code,
          first_name: student.first_name,
          last_name: student.last_name,
          categoryScores,
          totalScore: Number(totalWeighted.toFixed(2)),
          grade: finalGrade,
        };
      });
    });

    return res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// 3. สรุปรายบุคคล
export const getIndividualStudentSummary = async (req: any, res: any) => {
  const { studentId, semesterId } = req.query;

  if (!studentId || !semesterId)
    return res.status(400).json({ message: "Missing params" });

  try {
    const [student, assignments, semesterInfo] = await Promise.all([
      prisma.student.findUnique({
        where: { id: Number(studentId) },
        include: {
          scores: {
            where: { assignment: { semester_id: Number(semesterId) } },
            include: { assignment: true },
          },
        },
      }),
      prisma.assignment.findMany({
        where: { semester_id: Number(semesterId) },
      }),
      prisma.courseSemester.findUnique({
        where: { id: Number(semesterId) },
        include: { gradeSettings: { orderBy: { score: "desc" } } }, // 🟢 ดึงจาก SemesterConfig
      }),
    ]);

    if (!student || !semesterInfo)
      return res.status(404).json({ message: "Data not found" });

    let totalWeighted = 0;
    const categoryBreakdown: Record<
      string,
      { earned: number; possible: number }
    > = {};

    assignments.forEach((assign) => {
      const scoreRec = student.scores.find(
        (s) => s.assignment_id === assign.id,
      );
      const earned =
        (Number(scoreRec?.score || 0) / Number(assign.maxScore)) *
        Number(assign.weight);

      if (!categoryBreakdown[assign.category]) {
        categoryBreakdown[assign.category] = { earned: 0, possible: 0 };
      }
      categoryBreakdown[assign.category].earned += earned;
      categoryBreakdown[assign.category].possible += Number(assign.weight);
      totalWeighted += earned;
    });

    const grade =
      semesterInfo.gradeSettings.find((g) => totalWeighted >= Number(g.score))
        ?.grade || "F";

    res.json({
      info: {
        id: student.id,
        code: student.student_code,
        name: `${student.first_name} ${student.last_name}`,
      },
      summary: { totalScore: Number(totalWeighted.toFixed(2)), grade },
      categories: categoryBreakdown,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
};
