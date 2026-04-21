export const SiteFooter = ({ className = "" }: { className?: string }) => {
    return (
        <footer className={`site-footer ${className}`.trim()}>
            <a href="http://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
                沪ICP备2026015123号
            </a>
        </footer>
    );
};
