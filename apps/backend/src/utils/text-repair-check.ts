import { normalizeExamName, normalizeName, repairText } from "./text.js";

type CaseItem = {
    input: string;
    expected: string;
    actual: string;
};

const cases: CaseItem[] = [
    { input: "鐜嬭开", expected: "王迪", actual: repairText("鐜嬭开") },
    { input: "寮犳垐", expected: "张戈", actual: repairText("寮犳垐") },
    { input: "寮犱笁", expected: "张三", actual: repairText("寮犱笁") },
    { input: "王迪", expected: "王迪", actual: normalizeName("王迪") },
    { input: "张戈", expected: "张戈", actual: normalizeName("张戈") },
    { input: "张三", expected: "张三", actual: normalizeName("张三") },
    { input: "高一(1)班", expected: "高一(1)班", actual: repairText("高一(1)班") },
    { input: "2026学年第一学期期中考试", expected: "2026学年 第一学期期中考试", actual: normalizeExamName("2026学年第一学期期中考试") }
];

const failed = cases.filter((item) => item.actual !== item.expected);

if (failed.length > 0) {
    failed.forEach((item) => {
        console.error(`文本修复校验失败：${item.input} => ${item.actual}，期望 ${item.expected}`);
    });
    process.exit(1);
}

console.log("文本修复校验通过");
