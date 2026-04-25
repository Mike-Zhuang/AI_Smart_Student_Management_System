import { useEffect, useState } from "react";
import { fetchWithAuth } from "../lib/api";

type AuthenticatedImageProps = {
    srcPath: string;
    alt: string;
    className?: string;
};

export const AuthenticatedImage = ({ srcPath, alt, className }: AuthenticatedImageProps) => {
    const [objectUrl, setObjectUrl] = useState("");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let activeObjectUrl = "";
        let cancelled = false;
        setObjectUrl("");
        setFailed(false);

        const loadImage = async () => {
            try {
                const response = await fetchWithAuth(srcPath);
                if (!response.ok) {
                    throw new Error("图片加载失败");
                }
                const blob = await response.blob();
                if (cancelled) {
                    return;
                }
                activeObjectUrl = URL.createObjectURL(blob);
                setObjectUrl(activeObjectUrl);
            } catch {
                if (!cancelled) {
                    setFailed(true);
                }
            }
        };

        void loadImage();

        return () => {
            cancelled = true;
            if (activeObjectUrl) {
                URL.revokeObjectURL(activeObjectUrl);
            }
        };
    }, [srcPath]);

    if (failed) {
        return <div className="media-placeholder">图片加载失败</div>;
    }

    if (!objectUrl) {
        return <div className="media-placeholder">图片加载中...</div>;
    }

    return <img className={className} src={objectUrl} alt={alt} loading="lazy" />;
};
