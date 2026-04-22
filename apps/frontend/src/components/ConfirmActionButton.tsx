import { useState, type ReactNode } from "react";

type ConfirmActionButtonProps = {
    buttonText: string;
    confirmTitle: string;
    confirmMessage: string;
    onConfirm: () => Promise<void> | void;
    className?: string;
    disabled?: boolean;
    loadingText?: string;
    children?: ReactNode;
};

export const ConfirmActionButton = ({
    buttonText,
    confirmTitle,
    confirmMessage,
    onConfirm,
    className = "secondary-btn",
    disabled = false,
    loadingText = "处理中...",
    children
}: ConfirmActionButtonProps) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await onConfirm();
            setOpen(false);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button type="button" className={className} disabled={disabled || loading} onClick={() => setOpen(true)}>
                {loading ? loadingText : buttonText}
            </button>
            {children}
            {open ? (
                <div className="confirm-modal-backdrop" role="presentation">
                    <div className="confirm-modal">
                        <h4>{confirmTitle}</h4>
                        <p>{confirmMessage}</p>
                        <div className="account-actions">
                            <button type="button" className="secondary-btn" onClick={() => setOpen(false)} disabled={loading}>
                                取消
                            </button>
                            <button type="button" className="primary-btn" onClick={() => void handleConfirm()} disabled={loading}>
                                {loading ? loadingText : "确认删除"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
};
