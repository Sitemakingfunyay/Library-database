
"use strict";

// Fill these in after creating your Supabase project.
// Never put a service-role key, password, or secret access code here.
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE";

const clientReady =
  window.supabase &&
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("_HERE") &&
  !SUPABASE_ANON_KEY.includes("_HERE");

const db = clientReady
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const $ = (id) => document.getElementById(id);

let librarian = false;
let currentBooks = [];
let activeCheckouts = [];
let catalogLoaded = false;

function message(id, text, kind = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "message" + (kind ? " " + kind : "");
}

function errorText(error) {
  return error?.message || "Something went wrong. Please try again.";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "—";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return value;
  return new Date(parts[0], parts[1] - 1, parts[2])
    .toLocaleDateString();
}

function isNeverLend(book) {
  return book.never_lend ||
    book.title.trim().toLowerCase() === "dragons love tacos";
}

function canLend(book) {
  return book.lendable && !isNeverLend(book);
}

function activeBookIds() {
  return new Set(activeCheckouts.map((checkout) => checkout.book_id));
}

function renderCatalog() {
  const search = $("search").value.trim().toLowerCase();
  const busyIds = activeBookIds();

  const filtered = currentBooks.filter((book) =>
    `${book.title} ${book.author}`.toLowerCase().includes(search)
  );

  $("book-count").textContent =
    `${filtered.length} book${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    $("catalog").innerHTML = "<p>No books matched your search.</p>";
    return;
  }

  $("catalog").innerHTML = filtered.map((book) => {
    let status = "Available";
    let statusClass = "";

    if (!canLend(book)) {
      status = "Not lendable";
      statusClass = "unavailable";
    } else if (busyIds.has(book.id)) {
      status = "Checked out";
      statusClass = "unavailable";
    }

    return `
      <article class="book-card">
        <div class="book-icon" aria-hidden="true">📚</div>
        <h3>${escapeHTML(book.title)}</h3>
        <p>By ${escapeHTML(book.author || "Unknown")}</p>
        <span class="status ${statusClass}">${status}</span>
      </article>`;
  }).join("");
}

function renderCheckoutOptions() {
  const select = $("checkout-book");
  const busyIds = activeBookIds();
  const available = currentBooks.filter(
    (book) => canLend(book) && !busyIds.has(book.id)
  );

  select.innerHTML = '<option value="">Choose an available book</option>' +
    available.map((book) =>
      `<option value="${book.id}">${escapeHTML(book.title)}</option>`
    ).join("");
}

function renderCheckouts() {
  const body = $("checkout-list");

  if (!activeCheckouts.length) {
    body.innerHTML =
      '<tr><td colspan="6">There are no active checkouts.</td></tr>';
    return;
  }

  const today = localDateString();

  body.innerHTML = activeCheckouts.map((checkout) => {
    const title = checkout.books?.title || "Book";
    const overdue = checkout.due_date < today;

    return `
      <tr>
        <td>${escapeHTML(title)}</td>
        <td>${escapeHTML(checkout.borrower_name)}</td>
        <td>${formatDate(checkout.checked_out_at)}</td>
        <td class="${overdue ? "overdue-text" : ""}">
          ${formatDate(checkout.due_date)}
        </td>
        <td>${overdue ? "OVERDUE" : "Checked out"}</td>
        <td>
          <button class="button return-button"
            type="button"
            data-checkout-id="${checkout.id}">
            Return
          </button>
        </td>
      </tr>`;
  }).join("");
}

async function loadCatalog() {
  if (!db) {
    $("catalog").innerHTML =
      "<p>The online database has not been connected yet.</p>";
    $("book-count").textContent = "Setup needed";
    message("catalog-message",
      "After connecting Supabase and running database.sql, refresh this page.");
    return;
  }

  const { data, error } = await db
    .from("books")
    .select("id,title,author,lendable,never_lend")
    .order("title");

  if (error) {
    message("catalog-message",
      "Couldn't load the catalog: " + errorText(error), "error");
    return;
  }

  currentBooks = data || [];
  catalogLoaded = true;
  message("catalog-message", "");
  renderCatalog();

  if (librarian) renderCheckoutOptions();
}

async function loadCheckouts() {
  if (!db || !librarian) return;

  const { data, error } = await db
    .from("checkouts")
    .select("id,book_id,borrower_name,checked_out_at,due_date,books(title)")
    .is("returned_at", null)
    .order("due_date");

  if (error) {
    message("librarian-message",
      "Couldn't load checkouts: " + errorText(error), "error");
    return;
  }

  activeCheckouts = data || [];
  renderCheckouts();
  renderCheckoutOptions();
  renderCatalog();
}

async function refreshLibrarianStatus() {
  if (!db) return;

  const { data: sessionData } = await db.auth.getSession();
  const session = sessionData?.session;

  if (!session) {
    librarian = false;
    $("librarian-panel").classList.add("hidden");
    $("login-toggle").classList.remove("hidden");
    activeCheckouts = [];
    renderCatalog();
    return;
  }

  const { data, error } = await db.rpc("is_librarian");

  if (error || data !== true) {
    librarian = false;
    await db.auth.signOut();
    $("librarian-panel").classList.add("hidden");
    $("login-toggle").classList.remove("hidden");
    message("login-message",
      "This account isn't authorized as a librarian. Ask your parent to check the librarian setup.",
      "error");
    return;
  }

  librarian = true;
  $("login-panel").classList.add("hidden");
  $("login-toggle").classList.add("hidden");
  $("librarian-panel").classList.remove("hidden");
  message("login-message", "");
  message("librarian-message", "Signed in as an authorized librarian.", "success");

  await loadCatalog();
  await loadCheckouts();
}

async function handleLogin(event) {
  event.preventDefault();

  if (!db) {
    message("login-message",
      "Connect the Supabase project first.", "error");
    return;
  }

  const email = $("email").value.trim();
  const password = $("password").value;

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    message("login-message", "Sign-in failed: " + errorText(error), "error");
    return;
  }

  $("password").value = "";
  await refreshLibrarianStatus();
}

async function handleCheckout(event) {
  event.preventDefault();

  if (!db || !librarian) {
    message("librarian-message", "Please sign in as a librarian.", "error");
    return;
  }

  const bookId = Number($("checkout-book").value);
  const borrower = $("borrower").value.trim();
  const book = currentBooks.find((item) => item.id === bookId);

  if (!book || !borrower) {
    message("librarian-message", "Choose a book and enter the borrower's name.", "error");
    return;
  }

  if (!canLend(book)) {
    message("librarian-message", "This book cannot be lent out.", "error");
    return;
  }

  if (activeBookIds().has(bookId)) {
    message("librarian-message", "That book is already checked out.", "error");
    return;
  }

  const { error } = await db.from("checkouts").insert({
    book_id: bookId,
    borrower_name: borrower,
    checked_out_at: localDateString()
  });

  if (error) {
    message("librarian-message",
      "Checkout failed: " + errorText(error), "error");
    return;
  }

  $("borrower").value = "";
  message("librarian-message", "Book checked out. It is due in seven days.", "success");
  await loadCheckouts();
}

async function handleReturn(checkoutId) {
  if (!db || !librarian) return;

  const { error } = await db
    .from("checkouts")
    .update({ returned_at: localDateString() })
    .eq("id", checkoutId)
    .is("returned_at", null);

  if (error) {
    message("librarian-message",
      "Return failed: " + errorText(error), "error");
    return;
  }

  message("librarian-message", "Book returned successfully.", "success");
  await loadCheckouts();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"' && quoted && text[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

async function importCSV() {
  if (!db || !librarian) {
    message("import-message", "Please sign in as a librarian.", "error");
    return;
  }

  const file = $("csv-file").files[0];

  if (!file) {
    message("import-message", "Choose a CSV file first.", "error");
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    message("import-message", "Please use a CSV file smaller than 2 MB.", "error");
    return;
  }

  const text = (await file.text()).replace(/^\uFEFF/, "");
  const rows = parseCSV(text);

  if (!rows.length) {
    message("import-message", "The file is empty.", "error");
    return;
  }

  const headers = rows[0].map((value) => value.toLowerCase().trim());
  const titleColumn = headers.findIndex((value) =>
    ["title", "book", "book title", "name"].includes(value)
  );
  const authorColumn = headers.findIndex((value) =>
    ["author", "writer"].includes(value)
  );

  let records;

  if (titleColumn >= 0) {
    records = rows.slice(1).map((row) => ({
      title: (row[titleColumn] || "").trim(),
      author: authorColumn >= 0
        ? (row[authorColumn] || "").trim() || "Unknown"
        : "Unknown"
    }));
  } else {
    // If there's no header, treat the first column as the title.
    records = rows.map((row) => ({
      title: (row[0] || "").trim(),
      author: (row[1] || "").trim() || "Unknown"
    }));
  }

  records = records.filter((book) => book.title);

  if (!records.length) {
    message("import-message",
      "No book titles were found. Use columns named Title and Author.", "error");
    return;
  }

  const specialTitles = new Set([
    "dragons love tacos",
    "the library lion"
  ]);

  const safeRecords = records.map((book) => {
    const special = specialTitles.has(book.title.toLowerCase());
    return {
      title: book.title,
      author: book.author,
      lendable: !special,
      never_lend: book.title.toLowerCase() === "dragons love tacos"
    };
  });

  const unique = new Map();
  for (const book of safeRecords) {
    unique.set(book.title.toLowerCase(), book);
  }

  const confirmed = window.confirm(
    `Import ${unique.size} book titles? Existing titles will be left unchanged.`
  );

  if (!confirmed) return;

  const { error } = await db
    .from("books")
    .upsert([...unique.values()], {
      onConflict: "title",
      ignoreDuplicates: true
    });

  if (error) {
    message("import-message", "Import failed: " + errorText(error), "error");
    return;
  }

  message("import-message",
    `Import complete. Processed ${unique.size} unique titles. Existing titles were not changed.`,
    "success");

  $("csv-file").value = "";
  await loadCatalog();
  if (librarian) await loadCheckouts();
}

async function printOverdue() {
  if (!db || !librarian) {
    message("librarian-message", "Sign in as a librarian first.", "error");
    return;
  }

  await loadCheckouts();

  const today = localDateString();
  const overdue = activeCheckouts.filter(
    (checkout) => checkout.due_date < today
  );

  if (!overdue.length) {
    message("librarian-message", "There are no overdue books to print.", "success");
    return;
  }

  const rows = overdue.map((checkout) => `
    <tr>
      <td>${escapeHTML(checkout.books?.title || "Book")}</td>
      <td>${escapeHTML(checkout.borrower_name)}</td>
      <td>${formatDate(checkout.checked_out_at)}</td>
      <td>${formatDate(checkout.due_date)}</td>
    </tr>`).join("");

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    message("librarian-message",
      "Your browser blocked the print window. Allow pop-ups for this site and try again.",
      "error");
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Room Library Overdue List</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #999; padding: 8px; text-align: left; }
        h1 { color: #234f87; }
      </style>
    </head>
    <body>
      <h1>Room Library — Overdue Books</h1>
      <p>Printed ${formatDate(today)}</p>
      <table>
        <thead><tr><th>Book</th><th>Borrower</th><th>Checked out</th><th>Due date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload = () => window.print();<\/script>
    </body></html>`);
  printWindow.document.close();
}

$("login-toggle").addEventListener("click", () => {
  $("login-panel").classList.toggle("hidden");
});

$("login-form").addEventListener("submit", handleLogin);
$("checkout-form").addEventListener("submit", handleCheckout);
$("import-button").addEventListener("click", importCSV);
$("refresh-button").addEventListener("click", loadCheckouts);
$("print-overdue").addEventListener("click", printOverdue);
$("search").addEventListener("input", renderCatalog);
$("logout-button").addEventListener("click", async () => {
  if (db) await db.auth.signOut();
  librarian = false;
  activeCheckouts = [];
  $("librarian-panel").classList.add("hidden");
  $("login-toggle").classList.remove("hidden");
  message("login-message", "You have signed out.");
  renderCatalog();
});

$("checkout-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-checkout-id]");
  if (button) handleReturn(Number(button.dataset.checkoutId));
});

if (!db) {
  loadCatalog();
  message("login-message",
    "Supabase setup is needed before librarian login will work.");
} else {
  db.auth.onAuthStateChange(() => {
    // Defer database work until the auth event has completed.
    setTimeout(() => refreshLibrarianStatus(), 0);
  });
  refreshLibrarianStatus();
}
