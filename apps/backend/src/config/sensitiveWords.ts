export type SensitiveCategory =
    | "violence"
    | "sexual"
    | "hate"
    | "bullying"
    | "self_harm"
    | "privacy";

export type SensitiveRule = {
    category: SensitiveCategory;
    label: string;
    patterns: RegExp[];
};

export const SENSITIVE_RULES: SensitiveRule[] = [
    {
        category: "violence",
        label: "违法暴力",
        patterns: [/爆炸物|炸学校|炸掉|砍死|捅死|杀人|灭口|枪击|纵火/i]
    },
    {
        category: "sexual",
        label: "色情低俗",
        patterns: [/色情|黄片|成人视频|约炮|嫖娼|裸聊|淫秽|强奸|迷奸/i]
    },
    {
        category: "hate",
        label: "极端仇恨",
        patterns: [/种族清洗|恐怖袭击|极端组织|仇恨宣言|灭绝.*群体/i]
    },
    {
        category: "bullying",
        label: "校园欺凌辱骂",
        patterns: [/往死里打|霸凌|欺凌.*同学|废物东西|贱人|去死吧|弄残/i]
    },
    {
        category: "self_harm",
        label: "自伤自杀高危",
        patterns: [/自杀|割腕|轻生|跳楼|服毒|结束生命|不想活了/i]
    },
    {
        category: "privacy",
        label: "隐私泄露",
        patterns: [
            /\b\d{17}[\dXx]\b/,
            /\b62\d{14,17}\b/,
            /身份证号|银行卡号|CVV|短信验证码|支付密码/i
        ]
    }
];
