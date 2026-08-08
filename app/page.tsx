"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type WorkRecord = {
  id: string;
  name: string;
  createdAt: string;
};

type MonthFolder = {
  label: string;
  records: WorkRecord[];
};

type YearFolder = {
  year: number;
  driveUrl?: string;
  months: MonthFolder[];
};

type DriveFolder = {
  label: string;
  icon: string;
  url: string;
};

const monthLabels = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const buildMonths = (): MonthFolder[] => monthLabels.map((label) => ({ label, records: [] }));

const syncedDriveFolders: DriveFolder[] = [
  { label: "-DATA", icon: "◫", url: "https://drive.google.com/drive/folders/1KtXRW5p5tuY4qLC8q0hOG5dcKtnCfCu-" },
  { label: "Tư vấn", icon: "⌂", url: "https://drive.google.com/drive/folders/1Yab8uHBsD52C2MYsfAf3gMB5J6QCyqDt" },
  { label: "Thiết kế", icon: "▣", url: "https://drive.google.com/drive/folders/1DZ9x1xvDFj2C_1tgPw9hxXGWwxbgO7q5" },
  { label: "Dự toán", icon: "⌁", url: "https://drive.google.com/drive/folders/1loJbkEr_FT8iWf0Q4yFPKf6z4GmDJd9B" },
  { label: "Thi công", icon: "♧", url: "https://drive.google.com/drive/folders/1l8QbIOmsjUPxk7WSQP0rhvp9__I7fwyc" },
  { label: "Nghiệm thu", icon: "✓", url: "https://drive.google.com/drive/folders/1UtILAuZidLcluaheQDxGt4XXeUUa5rOr" },
  { label: "Bảo hành", icon: "⚙", url: "https://drive.google.com/drive/folders/1xPYkwM5i6tO9F_O5aPAAVKbtKecj6_U_" },
  { label: "Nhân lực", icon: "♙", url: "https://drive.google.com/drive/folders/1tQEoQPp38kinet7FzjVFF0-k6O7YJqcN" },
].filter((folder) => !folder.label.startsWith("-"));

const initialYears: YearFolder[] = [
  { year: 2024, driveUrl: "https://drive.google.com/drive/folders/1IejHVzPV0UTsiPnkCKudmuKmNP2kJUuV", months: buildMonths() },
  { year: 2025, driveUrl: "https://drive.google.com/drive/folders/1PSBgGI6CGnV3T0rFpQ5ATGfytfob9kmH", months: buildMonths() },
  { year: 2026, driveUrl: "https://drive.google.com/drive/folders/1HIGyI5IuN_sti4ee4WUgmv-RP3iSP6dQ", months: buildMonths() },
];

const team = [
  ["SP", "Sandra Perry", "Product Manager", "lavender"],
  ["AC", "Antony Cardenas", "Sales Manager", "sand"],
  ["JC", "Jamal Connolly", "Growth Marketer", "rose"],
  ["CC", "Cara Cerr", "SEO Specialist", "sage"],
];

function saveWorkspace(years: YearFolder[]) {
  window.localStorage.setItem("gm-manager-consulting", JSON.stringify(years));
}

export default function Home() {
  const [activeFolder, setActiveFolder] = useState("Tư vấn");
  const [years, setYears] = useState<YearFolder[]>(initialYears);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedMonth, setSelectedMonth] = useState(8);
  const [yearDraft, setYearDraft] = useState("2027");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const now = new Date();
    setSelectedYear(now.getFullYear());
    setSelectedMonth(now.getMonth() + 1);
    setYearDraft(String(now.getFullYear() + 1));

    const savedWorkspace = window.localStorage.getItem("gm-manager-consulting");
    if (savedWorkspace) {
      try {
        setYears(JSON.parse(savedWorkspace) as YearFolder[]);
      } catch {
        window.localStorage.removeItem("gm-manager-consulting");
      }
    }
  }, []);

  const activeDriveFolder = syncedDriveFolders.find((folder) => folder.label === activeFolder);
  const activeYear = years.find((folder) => folder.year === selectedYear) ?? years[years.length - 1];
  const activeMonthFolder = activeYear?.months[selectedMonth - 1];
  const visibleRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    const records = activeMonthFolder?.records ?? [];
    return term ? records.filter((record) => record.name.toLowerCase().includes(term)) : records;
  }, [activeMonthFolder, search]);

  const persist = (nextYears: YearFolder[]) => {
    setYears(nextYears);
    saveWorkspace(nextYears);
  };

  const selectYear = (year: number) => {
    setSelectedYear(year);
    setYearDraft(String(year + 1));
  };

  const addYear = () => {
    const year = Number(yearDraft);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setNotice("Nhập năm hợp lệ từ 2000 đến 2100");
      return;
    }
    if (years.some((folder) => folder.year === year)) {
      setSelectedYear(year);
      setNotice(`Thư mục ${year} đã có sẵn`);
      return;
    }

    const nextYears = [...years, { year, months: buildMonths() }].sort((a, b) => a.year - b.year);
    persist(nextYears);
    setSelectedYear(year);
    setSelectedMonth(1);
    setYearDraft(String(year + 1));
    setNotice(`Đã tạo thư mục ${year} với 12 tháng`);
  };

  const addCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = customerName.trim();
    if (!name) return;

    const record: WorkRecord = {
      id: `${Date.now()}-${name}`,
      name,
      createdAt: new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date()),
    };
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : { ...monthFolder, records: [record, ...monthFolder.records] }),
    });
    persist(nextYears);
    setCustomerName("");
    setAddOpen(false);
    setNotice(`Đã thêm vào ${activeMonthFolder?.label}/${selectedYear}`);
  };

  const deleteRecord = (id: string) => {
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : { ...monthFolder, records: monthFolder.records.filter((record) => record.id !== id) }),
    });
    persist(nextYears);
    setNotice("Đã xóa dữ liệu — danh sách được cập nhật ngay");
  };

  return (
    <main className="crm-shell">
      <aside className="sidebar">
        <div className="brand">GM<span>manager</span></div>
        <p className="sidebar-label sidebar-label--top">Quy trình công việc</p>
        <nav className="main-nav" aria-label="Quy trình GM-manager">
          {syncedDriveFolders.map((folder) => (
            <button key={folder.label} onClick={() => setActiveFolder(folder.label)} className={`nav-row ${activeFolder === folder.label ? "nav-row--active" : ""}`}>
              <span className="nav-row__icon">{folder.icon}</span>
              <span>{folder.label}</span>
              <span className="nav-row__drive">↗</span>
            </button>
          ))}
        </nav>

        <section className="members">
          <div className="members__heading"><p className="sidebar-label">Members</p><button aria-label="Invite member" className="plain-plus">+</button></div>
          {team.map(([initials, name, role, color]) => (
            <div className="member" key={name}>
              <span className={`avatar avatar--${color}`}>{initials}</span>
              <span><b>{name}</b><small>{role}</small></span>
            </div>
          ))}
          <div className="member member--you">
            <span className="avatar avatar--you">IR</span>
            <span><b>Ilona Rollins</b><small>CRM Specialist</small></span>
            <span className="logout">↪</span>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search-box">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer..." aria-label="Search customer" />
          </label>
          <div className="topbar__actions">
            <span className="drive-status"><i /> Đã nạp GM-manager</span>
            <button className="add-button" onClick={() => setAddOpen(true)}><span>＋</span> Add customer</button>
          </div>
        </header>

        {activeFolder === "Tư vấn" ? (
          <section className="consulting-view">
            <header className="section-heading">
              <div>
                <p className="eyebrow">GM-manager / Tư vấn</p>
                <h1>Hồ sơ tư vấn</h1>
                <p className="section-description">Chọn thời gian để xem hồ sơ; mỗi năm có sẵn 12 thư mục tháng.</p>
              </div>
              <a href={activeDriveFolder?.url} target="_blank" rel="noreferrer" className="drive-link">Mở thư mục Drive ↗</a>
            </header>

            <div className="calendar-bar">
              <label>Tháng
                <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
                  {monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </select>
              </label>
              <label>Năm
                <select value={selectedYear} onChange={(event) => selectYear(Number(event.target.value))}>
                  {years.map((folder) => <option key={folder.year} value={folder.year}>{folder.year}</option>)}
                </select>
              </label>
              <span className="calendar-bar__hint">Danh sách chọn có thể cuộn để chọn tháng/năm</span>
              <div className="add-year">
                <input value={yearDraft} onChange={(event) => setYearDraft(event.target.value)} inputMode="numeric" aria-label="Năm cần thêm" />
                <button onClick={addYear}>＋ Thêm thư mục năm</button>
              </div>
            </div>

            <div className="consulting-layout">
              <section className="folder-browser" aria-label="Thư mục tư vấn theo năm và tháng">
                <div className="folder-browser__heading"><h2>Thư mục năm</h2><span>{years.length} năm</span></div>
                <div className="year-grid">
                  {years.map((yearFolder) => (
                    <article className={`year-folder ${selectedYear === yearFolder.year ? "year-folder--active" : ""}`} key={yearFolder.year}>
                      <div className="year-folder__top">
                        <button onClick={() => selectYear(yearFolder.year)} className="year-folder__title"><span>▰</span>{yearFolder.year}</button>
                        {yearFolder.driveUrl && <a href={yearFolder.driveUrl} target="_blank" rel="noreferrer" aria-label={`Open ${yearFolder.year} in Drive`}>↗</a>}
                      </div>
                      <p>12 thư mục tháng</p>
                      <div className="month-grid">
                        {yearFolder.months.map((monthFolder, index) => (
                          <button key={monthFolder.label} onClick={() => { setSelectedYear(yearFolder.year); setSelectedMonth(index + 1); }} className={selectedYear === yearFolder.year && selectedMonth === index + 1 ? "month-button month-button--active" : "month-button"}>
                            <span>{monthFolder.label}</span><small>{monthFolder.records.length}</small>
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <aside className="month-detail">
                <div className="month-detail__heading">
                  <div><p className="eyebrow">Thư mục đang chọn</p><h2>{activeMonthFolder?.label} / {activeYear?.year}</h2></div>
                  <span>{visibleRecords.length} hồ sơ</span>
                </div>
                <div className="record-list">
                  {visibleRecords.length ? visibleRecords.map((record) => (
                    <article className="record-row" key={record.id}>
                      <span className="record-icon">▤</span>
                      <div><b>{record.name}</b><small>Thêm ngày {record.createdAt}</small></div>
                      <button onClick={() => deleteRecord(record.id)} aria-label={`Xóa ${record.name}`}>×</button>
                    </article>
                  )) : <div className="empty-records"><span>▱</span><p>Chưa có hồ sơ trong thư mục này.</p><button onClick={() => setAddOpen(true)}>Thêm hồ sơ đầu tiên</button></div>}
                </div>
              </aside>
            </div>
          </section>
        ) : (
          <section className="coming-soon">
            <span>{activeDriveFolder?.icon}</span>
            <p className="eyebrow">GM-manager</p>
            <h1>{activeFolder}</h1>
            <p>Khu vực này đã được liên kết với thư mục cùng tên trong GM-manager. Cấu trúc hồ sơ sẽ được mở rộng theo cùng mô hình năm/tháng.</p>
            <a href={activeDriveFolder?.url} target="_blank" rel="noreferrer" className="add-button">Mở trên Drive ↗</a>
          </section>
        )}
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      </section>

      {addOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setAddOpen(false)}>
          <form className="add-dialog" onSubmit={addCustomer} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setAddOpen(false)} aria-label="Đóng">×</button>
            <p className="eyebrow">{activeMonthFolder?.label} / {selectedYear}</p>
            <h2>Thêm hồ sơ tư vấn</h2>
            <label>Tên khách hàng hoặc hồ sơ<input autoFocus value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ví dụ: Nhà phố An Nhiên" /></label>
            <button className="add-button" type="submit">Lưu vào thư mục</button>
          </form>
        </div>
      )}
    </main>
  );
}
