import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { storage } from "../lib/storage";
import type { User } from "../lib/types";
import { useAuth } from "../App";

export const RegisterPage = () => {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    inviteCode: "",
    studentNo: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await apiRequest<{ token: string; user: User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
        skipAuth: true
      });

      storage.setToken(response.data.token);
      setUser(response.data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>邀请码注册</h1>
        <p>演示默认邀请码示例: INVITE-TEACHER-2026</p>

        <form onSubmit={onSubmit} className="form-stack">
          <label>
            用户名
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </label>
          <label>
            显示名
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          <label>
            邀请码
            <input
              value={form.inviteCode}
              onChange={(e) => setForm({ ...form, inviteCode: e.target.value })}
              required
            />
          </label>
          <label>
            学号（家长/学生可选）
            <input value={form.studentNo} onChange={(e) => setForm({ ...form, studentNo: e.target.value })} />
          </label>

          {error ? <p className="error-text">{error}</p> : null}

          <button className="primary-btn" disabled={loading} type="submit">
            {loading ? "注册中..." : "注册并登录"}
          </button>
        </form>

        <p className="inline-tip">
          已有账号？<Link to="/login">返回登录</Link>
        </p>
      </div>
    </div>
  );
};
