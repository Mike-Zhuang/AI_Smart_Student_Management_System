export type PromptTemplate = {
    id: string;
    name: string;
    scenario: "career" | "growth" | "home-school" | "teaching";
    description: string;
    recommendedModels: string[];
    template: string;
    outputSpec: string;
};

export const PROMPT_TEMPLATES: PromptTemplate[] = [
    {
        id: "career-structured-v1",
        name: "生涯选课建议（结构化）",
        scenario: "career",
        description: "面向高中3+1+2选课，输出可解释分维度建议与反事实说明。",
        recommendedModels: ["glm-4.7-flash", "glm-4.1v-thinking-flash"],
        template:
            "你是中国大陆高中生涯规划专家。请基于以下输入输出严谨建议。\n\n学生数据：\n{{studentData}}\n\n要求：\n1) 明确推荐组合并给出理由；\n2) 输出五个维度评分（science/social/logic/language/stability）；\n3) 给出证据链条（每条证据对应一个维度）；\n4) 给出反事实分析：如果文科/理科某维度提升，会如何影响组合选择。\n\n输出必须是合法 JSON，不要输出 markdown。",
        outputSpec:
            '{"selectedCombination":"","summary":"","dimensionScores":{"science":0,"social":0,"logic":0,"language":0,"stability":0},"evidenceChain":[{"dimension":"","evidence":"","impact":""}],"counterfactual":"","majorSuggestions":[""],"confidence":0}'
    },
    {
        id: "growth-risk-v1",
        name: "学业风险诊断（班主任版）",
        scenario: "growth",
        description: "对学生近期成绩趋势和行为记录进行风险研判并给出干预动作。",
        recommendedModels: ["glm-4.7-flash", "glm-4.1v-thinking-flash"],
        template:
            "你是班主任学情分析助手。请根据以下输入进行风险诊断。\n\n输入：\n{{studentData}}\n\n要求：\n1) 风险等级必须为 high/medium/low；\n2) 列出最多3个风险因子；\n3) 给出可执行干预动作（按优先级排序）；\n4) 保持措辞谨慎，不夸大结论。\n\n输出必须是合法 JSON。",
        outputSpec:
            '{"riskLevel":"low","riskFactors":[""],"actions":[{"priority":1,"action":"","owner":"班主任","timeline":"7天内"}],"followUp":""}'
    },
    {
        id: "home-school-reply-v1",
        name: "家校沟通回复（高共情）",
        scenario: "home-school",
        description: "用于家长咨询自动回复草稿，强调共情与可执行建议。",
        recommendedModels: ["glm-4.7-flash", "glm-4.6v-flash"],
        template:
            "你是高中班主任沟通助理。请对家长消息生成回复草稿。\n\n家长消息：\n{{parentMessage}}\n\n要求：\n1) 先共情，再给事实，再给建议；\n2) 建议不超过3条且可执行；\n3) 避免绝对化承诺；\n4) 语气礼貌、专业。\n\n输出为纯文本，不要出现 markdown 标记。",
        outputSpec: "纯文本，三段式结构：共情-事实-建议"
    },
    {
        id: "teaching-research-v1",
        name: "教研任务优化（可落地）",
        scenario: "teaching",
        description: "围绕备课、教研、培训任务生成周计划与绩效指标。",
        recommendedModels: ["glm-4.7-flash"],
        template:
            "你是高中教研管理顾问。请根据以下任务生成一周执行计划。\n\n任务输入：\n{{taskData}}\n\n要求：\n1) 输出日历化计划；\n2) 每项任务给1个量化验收指标；\n3) 标注风险点与缓解措施。\n\n输出必须是合法 JSON。",
        outputSpec:
            '{"weeklyPlan":[{"day":"周一","task":"","owner":"","metric":""}],"risks":[{"risk":"","mitigation":""}]}'
    }
];

export const fillTemplate = (template: string, variables: Record<string, string>): string => {
    return template.replace(/\{\{(\w+)\}\}/g, (_all, key: string) => variables[key] ?? "");
};

export const getTemplateById = (id: string): PromptTemplate | undefined => {
    return PROMPT_TEMPLATES.find((item) => item.id === id);
};
