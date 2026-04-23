import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";
import { useAuth } from "../App";
import { SiteFooter } from "../components/SiteFooter";

export const LoginPage = () => {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [formStartedAt, setFormStartedAt] = useState(() => Date.now());
  const [challengeQuestion, setChallengeQuestion] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [challengeAnswer, setChallengeAnswer] = useState("");
  const [challengeRequired, setChallengeRequired] = useState(false);

  const loadRiskChallenge = async (): Promise<boolean> => {
    if (!username.trim()) {
      setChallengeRequired(false);
      setChallengeQuestion("");
      setChallengeToken("");
      return false;
    }

    try {
      const response = await apiRequest<{
        required: boolean;
        challengeQuestion?: string;
        challengeToken?: string;
      }>(`/api/auth/risk-challenge?username=${encodeURIComponent(username.trim())}`, {
        skipAuth: true
      });

      const required = Boolean(response.data.required);
      setChallengeRequired(required);
      setChallengeQuestion(response.data.challengeQuestion ?? "");
      setChallengeToken(response.data.challengeToken ?? "");
      if (!required) {
        setChallengeAnswer("");
      }
      return required;
    } catch {
      return false;
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const required = challengeRequired || await loadRiskChallenge();
      if (required && !challengeAnswer.trim()) {
        setError("当前登录存在风险，请先完成安全校验。");
        setLoading(false);
        return;
      }

      const response = await apiRequest<{ token: string; user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username,
          password,
          honeypot,
          submittedAt: formStartedAt,
          riskChallengeToken: challengeToken || undefined,
          riskChallengeAnswer: challengeAnswer || undefined
        }),
        skipAuth: true
      });

      storage.setToken(response.data.token);
      setUser(response.data.user);
      navigate("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败";
      setError(message);
      if (message.includes("风险校验")) {
        await loadRiskChallenge();
      }
      setFormStartedAt(Date.now());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>登录系统</h1>
        <p>请使用学校或管理员分配的账号登录。</p>
        <p>安全提醒：首次登录后请尽快修改为包含大小写字母、数字和特殊字符的强密码。</p>

        <form onSubmit={onSubmit} className="form-stack">
          <input
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
            style={{ position: "absolute", left: "-9999px", opacity: 0, pointerEvents: "none" }}
            aria-hidden="true"
          />
          <label>
            用户名
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setChallengeRequired(false);
                setChallengeQuestion("");
                setChallengeToken("");
                setChallengeAnswer("");
              }}
              onBlur={() => {
                void loadRiskChallenge();
              }}
              autoComplete="username"
              required
            />
          </label>

          <label>
            密码
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
          </label>

          {challengeRequired ? (
            <label>
              安全校验
              <input
                value={challengeAnswer}
                onChange={(event) => setChallengeAnswer(event.target.value)}
                placeholder={challengeQuestion || "请输入校验答案"}
                required={challengeRequired}
              />
              <small>{challengeQuestion}</small>
            </label>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}

          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
      <SiteFooter className="auth-footer" />
    </div>
  );
};
