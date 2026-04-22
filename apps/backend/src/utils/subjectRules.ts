export const FIRST_SUBJECT_OPTIONS = ["物理", "历史"] as const;
export const SECONDARY_SUBJECT_OPTIONS = ["化学", "生物", "政治", "地理"] as const;

export const ACADEMIC_STAGE_OPTIONS = ["高一上", "高一下", "高二", "高三"] as const;

export type AcademicStage = (typeof ACADEMIC_STAGE_OPTIONS)[number];

export type SelectionStatus = "locked" | "not_started" | "selected";

const STAGE_BY_GRADE: Record<string, AcademicStage[]> = {
    高一: ["高一上", "高一下"],
    高二: ["高二"],
    高三: ["高三"]
};

export const getAllowedStagesByGrade = (grade: string): AcademicStage[] => {
    return STAGE_BY_GRADE[grade] ?? ["高二"];
};

export const isValidStageForGrade = (grade: string, stage: AcademicStage): boolean => {
    return getAllowedStagesByGrade(grade).includes(stage);
};

export const normalizeStageFromGrade = (grade: string, studentId: number): AcademicStage => {
    if (grade === "高一") {
        return studentId % 2 === 0 ? "高一上" : "高一下";
    }

    if (grade === "高二") {
        return "高二";
    }

    return "高三";
};

export const parseSubjectCombination = (
    combination: string | null | undefined
): { first: string | null; second: string | null; third: string | null } => {
    if (!combination) {
        return { first: null, second: null, third: null };
    }

    const parts = combination
        .split("+")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

    if (parts.length !== 3) {
        return { first: null, second: null, third: null };
    }

    return {
        first: parts[0],
        second: parts[1],
        third: parts[2]
    };
};

export const buildSubjectCombination = (
    first: string | null,
    second: string | null,
    third: string | null
): string | null => {
    if (!first || !second || !third) {
        return null;
    }

    return `${first}+${second}+${third}`;
};

export const getAllAllowedCombinations = (): string[] => {
    const list: string[] = [];

    for (const first of FIRST_SUBJECT_OPTIONS) {
        for (let i = 0; i < SECONDARY_SUBJECT_OPTIONS.length; i += 1) {
            for (let j = i + 1; j < SECONDARY_SUBJECT_OPTIONS.length; j += 1) {
                list.push(`${first}+${SECONDARY_SUBJECT_OPTIONS[i]}+${SECONDARY_SUBJECT_OPTIONS[j]}`);
            }
        }
    }

    return list;
};

export const isValidCombination = (combination: string): boolean => {
    const parsed = parseSubjectCombination(combination);
    if (!parsed.first || !parsed.second || !parsed.third) {
        return false;
    }

    if (!(FIRST_SUBJECT_OPTIONS as readonly string[]).includes(parsed.first)) {
        return false;
    }

    if (!(SECONDARY_SUBJECT_OPTIONS as readonly string[]).includes(parsed.second)) {
        return false;
    }

    if (!(SECONDARY_SUBJECT_OPTIONS as readonly string[]).includes(parsed.third)) {
        return false;
    }

    if (parsed.second === parsed.third) {
        return false;
    }

    return true;
};

export const validateSelectionByStage = (params: {
    stage: AcademicStage;
    firstSelectedSubject: string | null;
    secondSelectedSubject: string | null;
    thirdSelectedSubject: string | null;
}):
    | {
          ok: true;
          selectionStatus: SelectionStatus;
          firstSelectedSubject: string | null;
          secondSelectedSubject: string | null;
          thirdSelectedSubject: string | null;
          subjectCombination: string | null;
      }
    | { ok: false; message: string } => {
    const { stage, firstSelectedSubject, secondSelectedSubject, thirdSelectedSubject } = params;

    if (!firstSelectedSubject || !secondSelectedSubject || !thirdSelectedSubject) {
        return { ok: false, message: `${stage}学段需完整选择“1门首选科 + 2门再选科”` };
    }

    if (!(FIRST_SUBJECT_OPTIONS as readonly string[]).includes(firstSelectedSubject)) {
        return { ok: false, message: "首选科仅支持“物理”或“历史”" };
    }

    if (!(SECONDARY_SUBJECT_OPTIONS as readonly string[]).includes(secondSelectedSubject)) {
        return { ok: false, message: "再选科仅支持“化学/生物/政治/地理”" };
    }

    if (!(SECONDARY_SUBJECT_OPTIONS as readonly string[]).includes(thirdSelectedSubject)) {
        return { ok: false, message: "再选科仅支持“化学/生物/政治/地理”" };
    }

    if (secondSelectedSubject === thirdSelectedSubject) {
        return { ok: false, message: "两门再选科不能重复" };
    }

    return {
        ok: true,
        selectionStatus: "selected",
        firstSelectedSubject,
        secondSelectedSubject,
        thirdSelectedSubject,
        subjectCombination: buildSubjectCombination(firstSelectedSubject, secondSelectedSubject, thirdSelectedSubject)
    };
};
