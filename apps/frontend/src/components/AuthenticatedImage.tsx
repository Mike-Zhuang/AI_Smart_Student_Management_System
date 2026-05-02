import { useEffect, useState } from "react";
import { fetchWithAuth } from "../lib/api";

type AuthenticatedImageProps = {
    srcPath: string;
    alt: string;
    className?: string;
};

const imageObjectUrlCache = new Map<string, string>();
const imageRequestCache = new Map<string, Promise<string>>();

export const preloadAuthenticatedImage = (srcPath: string): void => {
    if (!srcPath || imageObjectUrlCache.has(srcPath) || imageRequestCache.has(srcPath)) {
        return;
    }

    const request = (async () => {
        const response = await fetchWithAuth(srcPath);
        if (!response.ok) {
            throw new Error("图片加载失败");
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        imageObjectUrlCache.set(srcPath, objectUrl);
        return objectUrl;
    })();
    imageRequestCache.set(srcPath, request);
    request.catch(() => imageRequestCache.delete(srcPath));
};

export const AuthenticatedImage = ({ srcPath, alt, className }: AuthenticatedImageProps) => {
    const [objectUrl, setObjectUrl] = useState("");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setObjectUrl("");
        setFailed(false);

        const loadImage = async () => {
            try {
                const cachedUrl = imageObjectUrlCache.get(srcPath);
                if (cachedUrl) {
                    setObjectUrl(cachedUrl);
                    return;
                }

                preloadAuthenticatedImage(srcPath);
                const request = imageRequestCache.get(srcPath);
                if (!request) {
                    throw new Error("图片加载失败");
                }
                const nextObjectUrl = await request;
                if (cancelled) {
                    return;
                }
                setObjectUrl(nextObjectUrl);
            } catch {
                imageRequestCache.delete(srcPath);
                if (!cancelled) {
                    setFailed(true);
                }
            }
        };

        void loadImage();

        return () => {
            cancelled = true;
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
