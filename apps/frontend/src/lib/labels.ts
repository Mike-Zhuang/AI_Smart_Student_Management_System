import type { User } from "./types";

export const roleLabelMap: Record<User["role"], string> = {
    admin: "管理员",
    teacher: "教师",
    head_teacher: "班主任",
    parent: "家长",
    student: "学生"
};

export const leaveStatusLabelMap: Record<string, string> = {
    pending_parent_confirm: "待家长确认",
    pending_head_teacher_review: "待班主任审批",
    approved: "已批准",
    rejected: "已驳回",
    completed: "已销假",
    cancelled: "已撤回"
};

export const leaveTypeLabelMap: Record<string, string> = {
    sick: "病假",
    personal: "事假",
    other: "其他"
};

export const riskLevelLabelMap: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险"
};

export const selectionStatusLabelMap: Record<string, string> = {
    selected: "已确认选科",
    not_started: "待完善",
    locked: "待确认"
};

export const parentConfirmStatusLabelMap: Record<string, string> = {
    pending: "待确认",
    confirmed: "已确认",
    returned: "已退回"
};

export const commonStatusLabelMap: Record<string, string> = {
    pending: "待处理",
    approved: "已批准",
    rejected: "已驳回",
    completed: "已完成",
    confirmed: "已确认",
    returned: "已退回",
    cancelled: "已取消",
    todo: "待处理",
    in_progress: "进行中",
    done: "已完成",
    free: "免费",
    paid: "收费",
    text: "文本",
    image: "图片"
};

export const taskStatusLabelMap: Record<string, string> = {
    todo: "待处理",
    in_progress: "进行中",
    done: "已完成"
};

export const roleHomeMessageMap: Record<User["role"], string> = {
    admin: "请关注全校运行情况、最新导入结果和待处理异常预警。",
    head_teacher: "请优先处理请假审批、班级日志、家校回执和小组积分变动。",
    teacher: "请查看所带班级学情、家校通知和选科支持事项。",
    parent: "请查看孩子近况、请假进度和学校最新通知。",
    student: "请关注成长趋势、请假申请进度和选科完善建议。"
};

export const mapLabel = (value: string, dictionary: Record<string, string>): string => {
    return dictionary[value] ?? commonStatusLabelMap[value] ?? "未知状态";
};
