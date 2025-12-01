import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";

// PDF.js typing augmentation
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

type TabType = 'word' | 'latex' | 'settings';

const App = () => {
  // --- TABS STATE ---
  const [activeTab, setActiveTab] = useState<TabType>('word');
  const [lastActiveTab, setLastActiveTab] = useState<TabType>('word');

  // --- API KEY STATE ---
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  // --- CONVERSION STATE ---
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>(""); // Store text if user pastes text
  const [fileName, setFileName] = useState<string>("");
  
  // --- RESULT STATE ---
  const [resultContent, setResultContent] = useState<string>("");
  const contentEditableRef = useRef<HTMLDivElement>(null); 
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [progress, setProgress] = useState<number>(0); // 0 to 100
  const [error, setError] = useState<string | null>(null);
  
  // --- CONTROL REFS ---
  const abortRef = useRef<boolean>(false); // To signal stop

  // --- PREVIEW MODE STATE ---
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

  // --- INITIALIZATION ---
  useEffect(() => {
    const storedKey = localStorage.getItem("user_gemini_api_key");
    if (storedKey) setUserApiKey(storedKey);
  }, []);

  // Listen for paste events globally when on home tab to catch easy pastes
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (activeTab === 'word' || activeTab === 'latex') {
        handlePaste(e);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [activeTab]);

  // Handle MathJax Rendering when entering Preview Mode
  useEffect(() => {
    if (isPreviewMode && resultContent && (window as any).MathJax) {
       setTimeout(() => {
          (window as any).MathJax.typesetPromise && (window as any).MathJax.typesetPromise();
       }, 100);
    }
  }, [isPreviewMode, resultContent]);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setUserApiKey(newVal);
    localStorage.setItem("user_gemini_api_key", newVal);
  };

  const getApiKey = () => {
    return userApiKey.trim() || process.env.API_KEY || "";
  };

  // --- HELPER FUNCTIONS ---

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const createWordHtml = (content: string, title: string) => {
    return "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
      "xmlns:w='urn:schemas-microsoft-com:office:word' " +
      "xmlns='http://www.w3.org/TR/REC-html40'>" +
      "<head><meta charset='utf-8'><title>" + title + "</title>" +
      "<style>" + 
      "body { font-family: 'Be Vietnam Pro', 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; } " + 
      "p { margin-bottom: 6pt; margin-top: 0; } " +
      "table { border-collapse: collapse; width: 100%; margin-top: 10px; border: 2px solid #000; } " +
      "td { border: 1px solid #000; padding: 5px; color: #000; } " +
      "th { border: 1px solid #000; padding: 5px; background-color: #003366; color: #ffffff; font-weight: bold; } " +
      /* Force MathJax output to behave nicely in Word if possible, though Word uses images usually */
      "mjx-container { display: inline-block !important; margin: 0 !important; }" +
      "</style>" +
      "</head><body>" + content + "</body></html>";
  };

  const fileToGenericPart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        const base64Content = base64data.split(",")[1];
        resolve({ inlineData: { data: base64Content, mimeType: file.type } });
      };
      reader.onerror = () => reject(new Error("Lỗi khi đọc file."));
      reader.readAsDataURL(file);
    });
  };

  // --- PDF PROCESSING LOGIC ---

  const renderPdfPageToImage = async (pdfDoc: any, pageNum: number, scale = 2.0): Promise<string> => {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;
    // Return base64 string without the prefix for Gemini
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    return dataUrl.split(',')[1];
  };

  const processWithAI = async (parts: any[], mode: 'convert' | 'solve', currentTab: TabType) => {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const modelId = "gemini-2.5-flash";

      let systemInstruction = "";

      // === PROMPTS FOR WORD (HTML) ===
      if (currentTab === 'word') {
          if (mode === 'convert') {
             systemInstruction = `
Bạn là chuyên gia chuyển đổi tài liệu Toán - Lý - Hóa.
Nhiệm vụ: Chép lại nội dung hình ảnh/văn bản đầu vào thành mã HTML sạch, chuẩn để dán vào Word.

TUÂN THỦ 100% QUY TẮC:
1. **Chính tả & Unicode**: Sửa lỗi chính tả tiếng Việt và lỗi font unicode.
2. **Toán học & Khoa học**:
   - Công thức toán BẮT BUỘC đặt trong dấu $...$ (LaTeX inline).
   - Công thức trong dòng dùng $...$ (inline), KHÔNG dùng $$...$$ (block) và KHÔNG xuống dòng ngắt quãng.
   - Ký tự Hy Lạp: ρ → \\rho, θ → \\theta, α → \\alpha...
   - Đơn vị: $50\\;cm$, $300^\\circ C$, \\%.
3. **Cấu trúc**:
   - XÓA bảng đánh dấu Đúng/Sai, thay bằng danh sách a), b)...
   - Bỏ dấu "*" thừa.
   - Dùng thẻ <p> cho đoạn văn, <br> ngắt dòng.
4. **Nguyên tắc**: Chỉ trả về HTML body content. Không Markdown.
`;
          } else {
             systemInstruction = `
Bạn là giáo viên giỏi.
Nhiệm vụ: Giải chi tiết và hướng dẫn làm bài cho nội dung đầu vào.

YÊU CẦU:
1. Trích dẫn câu hỏi (ngắn gọn) rồi giải chi tiết.
2. Giải thích logic, công thức.
3. Dùng HTML (<h3>, <p>, <b>, <ul>).
4. Toán/Lý/Hóa dùng LaTeX trong dấu $. Viết liền mạch, KHÔNG xuống dòng ngắt quãng.
5. **QUAN TRỌNG**: Sau khi giải chi tiết xong, hãy tự rút ra đáp án đúng nhất cho từng câu và điền vào bảng tổng hợp cuối cùng. Tuyệt đối không được để bảng trống.
6. **ĐỊNH DẠNG BẢNG ĐÁP ÁN**: Tạo bảng HTML 10 cột, nội dung dạng **1.A**, **2.B**. Tiêu đề bảng là "BẢNG ĐÁP ÁN TỔNG HỢP".
`;
          }
      } 
      // === PROMPTS FOR LATEX ===
      else if (currentTab === 'latex') {
          // Common LaTeX Preamble instructions
          const latexHeader = `
\\documentclass[12pt,a4paper]{article}
\\usepackage[light,condensed,math]{anttor}
\\usepackage{amsmath,amssymb,tasks,graphicx,geometry}
\\usepackage[utf8]{vietnam}
\\usepackage[dethi]{ex_test}
\\geometry{top=1.5cm, bottom=1.5cm, left=2cm, right=1.5cm}
`;

          if (mode === 'convert') {
              systemInstruction = `
Bạn là chuyên gia chuyển đổi LaTeX sử dụng gói lệnh 'ex_test' (tương tự dethi.sty).
Nhiệm vụ: Chuyển đổi nội dung đầu vào thành mã LaTeX hoàn chỉnh.

QUY TẮC NHẬN DIỆN VÀ ĐỊNH DẠNG CẤU TRÚC:

1. **Loại 1: Trắc nghiệm 4 đáp án (A, B, C, D)**
   - Cấu trúc:
     \\begin{ex}
     Nội dung câu hỏi...
     \\choice
     {Phương án A}
     {\\True Phương án B} % Nếu B là đáp án đúng (được tô màu/gạch chân)
     {Phương án C}
     {Phương án D}
     \\loigiai{
       \\begin{itemize}
       \\item 
       \\end{itemize}
     }
     \\end{ex}
   - Lưu ý: Nếu chưa có đáp án đúng, không dùng \\True.

2. **Loại 2: Trắc nghiệm Đúng/Sai (a, b, c, d)**
   - Cấu trúc:
     \\begin{ex}
     Nội dung câu hỏi...
     \\choiceTFt
     {Phát biểu a}
     {\\True Phát biểu b} % Nếu b đúng
     {Phát biểu c}
     {Phát biểu d}
     \\loigiai{
       \\begin{itemize}
       \\item 
       \\end{itemize}
     }
     \\end{ex}

3. **Loại 3: Tự luận ngắn (Không có phương án lựa chọn)**
   - Cấu trúc:
     \\begin{ex}
     Nội dung câu hỏi...
     \\shortans[oly]{Đáp án} % Nếu có đáp án số
     \\loigiai{
       \\begin{itemize}
       \\item 
       \\end{itemize}
     }
     \\end{ex}

YÊU CẦU CHUNG:
- Bắt đầu file bằng: ${latexHeader.replace(/\n/g, " ")} \\begin{document}
- Kết thúc file bằng: \\end{document}
- Công thức toán: Dùng $...$ cho inline. Sửa các ký tự đặc biệt ($^\circ C$, \%, $30\\;cm$).
- Sửa lỗi chính tả tiếng Việt.
- Chỉ trả về mã LaTeX raw text.
`;
          } else {
              systemInstruction = `
Bạn là giáo viên giỏi soạn thảo bằng LaTeX (gói ex_test).
Nhiệm vụ: Giải chi tiết đề thi và xuất ra mã LaTeX.

YÊU CẦU CẤU TRÚC (BẮT BUỘC):
Sử dụng đúng 3 loại môi trường:
1. \\begin{ex} ... \\choice ... \\loigiai{} \\end{ex} (4 đáp án)
2. \\begin{ex} ... \\choiceTFt ... \\loigiai{} \\end{ex} (Đúng/Sai)
3. \\begin{ex} ... \\shortans[oly]{} \\loigiai{} \\end{ex} (Trả lời ngắn)

HƯỚNG DẪN GIẢI:
- Điền lời giải chi tiết vào bên trong thẻ \\loigiai{...}.
- Sử dụng môi trường \\begin{itemize} \\item ... \\end{itemize} trong lời giải.
- Xác định đáp án đúng và thêm lệnh \\True vào trước phương án đó trong \\choice hoặc \\choiceTFt.
- Tính toán và điền đáp án số vào \\shortans[oly]{...} cho câu tự luận ngắn.

QUAN TRỌNG:
- Bắt đầu file bằng preamble chuẩn (anttor, ex_test, vietnam...).
- Cuối file tạo bảng đáp án tổng hợp (nếu có thể).
- Chỉ trả về mã LaTeX.
`;
          }
      }

      // Add prompt to parts
      const requestParts = [...parts, { text: systemInstruction }];

      const response = await ai.models.generateContent({
        model: modelId,
        contents: { parts: requestParts },
        config: { temperature: mode === 'convert' ? 0.1 : 0.4 }
      });

      let text = response.text || "";
      // Strip markdown code blocks if any remain
      return text.replace(/```html|```latex|```tex|```/g, "").trim();
  };

  const processPdfInBatches = async (file: File, mode: 'convert' | 'solve') => {
    try {
      if (!window.pdfjsLib) throw new Error("Thư viện PDF chưa tải xong. Vui lòng đợi 3 giây rồi thử lại.");
      
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await window.pdfjsLib.getDocument(arrayBuffer).promise;
      const totalPages = pdfDoc.numPages;
      const BATCH_SIZE = 3; // Process 3 pages at a time to avoid overload
      const MAX_RETRIES = 5;
      
      for (let i = 1; i <= totalPages; i += BATCH_SIZE) {
        // CHECK STOP CONDITION
        if (abortRef.current) {
            setLoadingStatus("Đã dừng bởi người dùng.");
            break;
        }

        const startPage = i;
        const endPage = Math.min(i + BATCH_SIZE - 1, totalPages);
        
        setProgress(Math.round(((i - 1) / totalPages) * 100));

        // RETRY LOOP
        let success = false;
        let retryCount = 0;

        while (!success && !abortRef.current && retryCount < MAX_RETRIES) {
            try {
                setLoadingStatus(`Đang xử lý trang ${startPage} - ${endPage} / ${totalPages}... ${retryCount > 0 ? `(Thử lại lần ${retryCount})` : ''}`);
                
                // Render pages in this batch to images
                const imageParts = [];
                for (let p = startPage; p <= endPage; p++) {
                    const base64Image = await renderPdfPageToImage(pdfDoc, p);
                    imageParts.push({ inlineData: { data: base64Image, mimeType: 'image/jpeg' } });
                }

                // Send this batch to AI (Pass activeTab to select prompt)
                let batchResult = await processWithAI(imageParts, mode, activeTab as TabType);
                
                // Check Abort BEFORE updating content
                if (abortRef.current) {
                    setLoadingStatus("Đã dừng. Bỏ qua kết quả cuối.");
                    break;
                }
                
                // Append result IMMEDIATELY for streaming effect
                setResultContent(prev => prev + batchResult + (activeTab === 'word' ? "<br/><br/>" : "\n\n% --- Next Batch ---\n\n"));
                
                success = true; // Mark as success to exit retry loop
            } catch (err) {
                console.warn(`Batch ${startPage}-${endPage} failed:`, err);
                retryCount++;
                if (retryCount >= MAX_RETRIES) {
                    const errorMsg = activeTab === 'word' 
                        ? `<br/><p style="color:red; font-weight:bold;">[LỖI: Không thể xử lý trang ${startPage}-${endPage} sau nhiều lần thử. Đang bỏ qua...]</p><br/>`
                        : `\n% [LỖI: Không thể xử lý trang ${startPage}-${endPage} sau nhiều lần thử]\n`;
                    setResultContent(prev => prev + errorMsg);
                    // We don't throw here, we just skip this chunk and continue to next
                    success = true; 
                } else {
                    if (abortRef.current) break;
                    setLoadingStatus(`Gặp lỗi kết nối. Đang đợi 5 giây để thử lại (Lần ${retryCount}/${MAX_RETRIES})...`);
                    await wait(5000); // Wait 5 seconds before retrying
                }
            }
        }
      }

      if (!abortRef.current) {
          setProgress(100);
      }

    } catch (e: any) {
      throw new Error(`Lỗi xử lý PDF: ${e.message}`);
    }
  };

  // --- HANDLERS ---

  const handleStop = () => {
    // Immediate feedback, no confirmation dialog
    abortRef.current = true;
    setLoadingStatus("Đang dừng... (Vui lòng đợi xử lý nốt phần hiện tại)");
  };

  const handleTabChange = (newTab: TabType) => {
      // Clear content when switching contexts to avoid format mismatch
      if ((newTab === 'word' && activeTab === 'latex') || (newTab === 'latex' && activeTab === 'word')) {
          setResultContent("");
          setFile(null);
          setFileName("");
          setPastedText("");
          setProgress(0);
          setError(null);
      }
      setActiveTab(newTab);
  };

  const handleSettingsClick = () => {
      setLastActiveTab(activeTab);
      setActiveTab('settings');
  };

  const handleBackClick = () => {
      setActiveTab(lastActiveTab);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name);
      setPastedText(""); 
      setError(null);
      setResultContent("");
      setIsPreviewMode(false);
      setProgress(0);
    }
  };

  const handlePaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          setFile(blob);
          setFileName("Pasted_Image_" + new Date().getTime() + ".png");
          setPastedText("");
          setError(null);
          setResultContent("");
          setIsPreviewMode(false);
          setProgress(0);
          e.preventDefault();
          return;
        }
      }
    }
    
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        const text = e.clipboardData?.getData("text");
        if (text) {
             setPastedText(text);
             setFile(null);
             setFileName("");
             setError(null);
             setResultContent("");
             setIsPreviewMode(false);
             setProgress(0);
        }
    }
  };

  const executeAction = async (mode: 'convert' | 'solve') => {
    if (!file && !pastedText) return setError("Vui lòng tải file hoặc dán nội dung (Ctrl+V).");
    
    setIsLoading(true);
    abortRef.current = false; // RESET STOP FLAG
    setError(null);
    setResultContent(""); 
    setLoadingStatus("Đang khởi tạo...");
    setProgress(0);
    setIsPreviewMode(false);

    try {
      // CASE 1: PDF FILE (Use Batching with Auto-Retry)
      if (file && file.type === 'application/pdf') {
         await processPdfInBatches(file, mode);
      } 
      // CASE 2: IMAGE OR TEXT (Single Request)
      else {
          setProgress(50);
          setLoadingStatus("Đang gửi dữ liệu lên AI...");
          const parts: any[] = [];
          
          if (file) {
              const filePart = await fileToGenericPart(file);
              parts.push(filePart);
          } else if (pastedText) {
              parts.push({ text: `Nội dung đầu vào:\n${pastedText}` });
          }

          // Pass activeTab to select prompt
          const result = await processWithAI(parts, mode, activeTab as TabType);
          if (!abortRef.current) {
              setResultContent(result);
              setProgress(100);
          }
      }

    } catch (err: any) {
      if (!abortRef.current) {
         setError("Lỗi: " + err.message);
      }
      setProgress(0);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  const handleDownload = () => {
    let contentToSave = resultContent;
    if (contentEditableRef.current) {
        // If Word, get InnerHTML. If LaTeX, get InnerText (raw code)
        contentToSave = activeTab === 'word' 
            ? contentEditableRef.current.innerHTML 
            : contentEditableRef.current.innerText;
    }
    if (!contentToSave) return;

    if (activeTab === 'word') {
        const sourceHTML = createWordHtml(contentToSave, "Converted Document");
        const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
        const link = document.createElement("a");
        link.href = source;
        link.download = `Converted_${fileName.split('.')[0] || 'Document'}.doc`;
        link.click();
    } else {
        // LaTeX Download (.tex file)
        const element = document.createElement("a");
        const file = new Blob([contentToSave], {type: 'text/plain'});
        element.href = URL.createObjectURL(file);
        element.download = `Converted_${fileName.split('.')[0] || 'Document'}.tex`;
        document.body.appendChild(element); 
        element.click();
        document.body.removeChild(element);
    }
  };

  const handleCopy = () => {
    let contentToCopy = "";
    if (contentEditableRef.current) {
         // Copy raw text for Latex, HTML for Word
         contentToCopy = activeTab === 'word' 
            ? contentEditableRef.current.innerHTML 
            : contentEditableRef.current.innerText;
    } else {
        contentToCopy = resultContent;
    }

    if (!contentToCopy) {
      alert("Không có nội dung để sao chép.");
      return;
    }

    try {
        if (activeTab === 'word') {
            const blob = new Blob([contentToCopy], { type: "text/html" });
            const textBlob = new Blob([contentEditableRef.current?.innerText || resultContent], { type: "text/plain" });
            const data = [new ClipboardItem({
                ["text/html"]: blob,
                ["text/plain"]: textBlob
            })];
            navigator.clipboard.write(data).then(() => alert("Đã sao chép nội dung Word!"));
        } else {
            // Simple text copy for LaTeX
            navigator.clipboard.writeText(contentToCopy).then(() => alert("Đã sao chép mã LaTeX!"));
        }
    } catch (err) {
        console.error("Lỗi khi sao chép:", err);
        alert("Lỗi khi sao chép. Vui lòng thử lại.");
    }
  };

  const handleOpenOverleaf = () => {
      let latexCode = "";
      if (contentEditableRef.current) {
          latexCode = contentEditableRef.current.innerText;
      } else {
          latexCode = resultContent;
      }

      if (!latexCode) {
          alert("Không có nội dung để chuyển sang Overleaf.");
          return;
      }

      // Create a form to POST data to Overleaf
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'https://www.overleaf.com/docs';
      form.target = '_blank';

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'snip';
      input.value = latexCode;

      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      document.body.removeChild(form);
  };

  const handleContentChange = (e: React.FormEvent<HTMLDivElement>) => {
     // For LaTeX we might want to preserve line breaks more carefully, but standard innerHTML -> state is fine for now
     setResultContent(e.currentTarget.innerHTML);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden" onPaste={handlePaste}>
      
      {/* LEFT PANEL: Sidebar / Controls */}
      <div className="w-full md:w-[400px] flex-shrink-0 bg-blue-900 text-white flex flex-col h-full shadow-2xl z-20 relative">
        <div className="p-6 flex-grow overflow-y-auto custom-scrollbar flex flex-col">
          
          {/* Header */}
          <div className="mb-8 flex-shrink-0">
             <h1 className="text-xl font-bold tracking-tight text-white/90 uppercase leading-snug">
               CHUYỂN ĐỔI FILE PDF VÀ ẢNH SANG WORD VÀ LATEX
             </h1>
          </div>

          {/* SETTINGS VIEW BACK BUTTON */}
          {activeTab === 'settings' ? (
              <button
                onClick={handleBackClick}
                className="w-full mb-6 py-3 px-4 bg-blue-800 hover:bg-blue-700 text-white rounded-xl flex items-center gap-3 font-bold transition-all shadow-lg border border-blue-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Quay lại
              </button>
          ) : (
             <div className="flex gap-3 mb-6">
                {/* WORD TAB BUTTON */}
                <button
                    onClick={() => handleTabChange('word')}
                    className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold transition-all ${activeTab === 'word' ? 'bg-white text-blue-900 shadow-lg' : 'bg-blue-800/50 text-blue-200 hover:bg-blue-800 hover:text-white'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Word
                </button>
                {/* LATEX TAB BUTTON */}
                <button
                    onClick={() => handleTabChange('latex')}
                    className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold transition-all ${activeTab === 'latex' ? 'bg-white text-blue-900 shadow-lg' : 'bg-blue-800/50 text-blue-200 hover:bg-blue-800 hover:text-white'}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                    LaTeX
                </button>
             </div>
          )}

          {/* === CONTENT FOR CONVERTER (WORD OR LATEX) === */}
          {(activeTab === 'word' || activeTab === 'latex') && (
            <div className="space-y-6 animate-fade-in-up">
              
              {/* Step 1: Upload / Paste */}
              <div>
                <div className="flex items-center gap-2 mb-2 text-blue-200 uppercase text-xs font-bold tracking-wider">
                  <span className="w-5 h-5 rounded-full border border-blue-300 flex items-center justify-center text-[10px]">1</span>
                  Tải lên hoặc Dán nội dung
                </div>
                
                <label className="block w-full cursor-pointer group mb-3">
                  <div className={`
                    relative border-2 border-dashed rounded-xl p-6 transition-all duration-300
                    ${(file || pastedText) ? 'border-green-400 bg-green-500/20' : 'border-blue-400/30 hover:border-blue-300 hover:bg-blue-800/50'}
                  `}>
                    <input 
                      type="file" 
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={handleFileChange}
                    />
                    <div className="text-center space-y-2 pointer-events-none">
                      {file ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-base font-medium text-green-300 truncate px-2">{fileName}</p>
                          <p className="text-xs text-green-200/70">
                            {file.type === 'application/pdf' ? 'Đã nhận dạng PDF (Hỗ trợ chia nhỏ)' : 'File ảnh đã sẵn sàng'}
                          </p>
                        </>
                      ) : pastedText ? (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p className="text-base font-medium text-green-300 px-2 line-clamp-2">{pastedText.substring(0, 50)}...</p>
                          <p className="text-xs text-green-200/70">Đã nhận nội dung văn bản</p>
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto text-blue-300/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-base font-medium text-blue-100">Chọn file PDF/Ảnh</p>
                          <p className="text-xs text-blue-300">Hoặc ấn <span className="font-bold text-white bg-blue-800 px-1 rounded">Ctrl + V</span> để dán ảnh/chữ trực tiếp</p>
                        </>
                      )}
                    </div>
                  </div>
                </label>
              </div>
                
              {/* Action Buttons */}
              <div className="space-y-3 pt-6">
                    {/* Progress Bar */}
                    {isLoading && (
                        <div className="w-full bg-blue-950 rounded-full h-2.5 mb-2 border border-blue-800">
                            <div className="bg-green-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                        </div>
                    )}

                    {/* Button 1: Convert */}
                    <button
                      onClick={() => executeAction('convert')}
                      disabled={isLoading || (!file && !pastedText)}
                      className={`w-full py-3.5 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all 
                        ${isLoading || (!file && !pastedText) ? 'bg-blue-950 text-blue-500 cursor-not-allowed border border-blue-800' : 'bg-white hover:bg-blue-50 text-blue-900'}`}
                    >
                      {isLoading && loadingStatus ? (
                        <>
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          <span className="text-sm truncate max-w-[200px]">{loadingStatus}</span>
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          <span>Chuyển đổi sang {activeTab === 'word' ? 'Word' : 'LaTeX'}</span>
                        </>
                      )}
                    </button>
                    
                    {/* Button 2: Solve */}
                    <button
                      onClick={() => executeAction('solve')}
                      disabled={isLoading || (!file && !pastedText)}
                      className={`w-full py-3.5 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all 
                        ${isLoading || (!file && !pastedText) 
                            ? 'bg-blue-950 text-blue-500 cursor-not-allowed border border-blue-800' 
                            : 'bg-yellow-500 hover:bg-yellow-400 text-blue-900 border border-yellow-500'}`}
                    >
                       {isLoading && loadingStatus ? (
                        <>
                           <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                           <span className="text-sm truncate max-w-[200px]">{loadingStatus}</span>
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          <span>Tạo Hướng Dẫn Giải (Từ file)</span>
                        </>
                      )}
                    </button>
                </div>

            </div>
          )}

          {/* === CONTENT FOR SETTINGS === */}
          {activeTab === 'settings' && (
              <div className="space-y-6 animate-fade-in-up">
                  <div className="bg-blue-950/50 p-4 rounded-xl border border-blue-800/30">
                      <h3 className="text-white font-bold text-sm mb-3 border-b border-blue-800 pb-2">THÔNG TIN TÁC GIẢ</h3>
                      <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-lg">H</div>
                          <div>
                              <p className="text-white font-bold text-sm">Nguyễn Đức Hiền</p>
                              <p className="text-blue-300 text-xs">Giáo viên Vật Lí</p>
                          </div>
                      </div>
                      <p className="text-blue-200 text-xs leading-relaxed italic">
                          Trường THCS và THPT Nguyễn Khuyến Bình Dương.
                      </p>
                  </div>

                  <div className="bg-blue-950/50 p-4 rounded-xl border border-blue-800/30">
                    <h3 className="text-white font-bold text-sm mb-3 border-b border-blue-800 pb-2">CẤU HÌNH HỆ THỐNG</h3>
                    <label className="text-xs font-bold text-blue-300 uppercase mb-2 block flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                        Google Gemini API Key
                    </label>
                    <div className="relative">
                        <input 
                        type={showApiKey ? "text" : "password"}
                        value={userApiKey}
                        onChange={handleApiKeyChange}
                        placeholder="Dán API Key của bạn..."
                        className="w-full bg-blue-900/50 border border-blue-700/50 rounded-lg pl-3 pr-10 py-2 text-xs text-white placeholder-blue-500 focus:outline-none focus:border-blue-400 mb-1"
                        />
                        <button 
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-blue-400 hover:text-white"
                        >
                        {showApiKey ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                        </button>
                    </div>
                    <p className="text-[10px] text-blue-400 italic mt-1">Key được lưu trong trình duyệt của bạn.</p>
                  </div>
              </div>
          )}
          
          {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg text-sm font-medium">{error}</div>}

        </div>
        
        {/* BOTTOM: SETTINGS BUTTON & FOOTER */}
        <div className="p-4 bg-blue-950 text-blue-400 text-xs border-t border-blue-800">
           {/* Settings Trigger */}
           <button 
              onClick={handleSettingsClick}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-3 transition-colors ${activeTab === 'settings' ? 'bg-blue-800 text-white' : 'hover:bg-blue-900 text-blue-300'}`}
           >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="font-bold uppercase tracking-wider">Cài Đặt</span>
           </button>
           <div className="text-center font-medium">
             <p>© 2025 Converter NK12</p>
           </div>
        </div>
      </div>

      {/* RIGHT PANEL: Result Preview */}
      <div className="flex-1 bg-white h-full overflow-hidden flex flex-col relative font-sans">
        
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10 min-h-[70px]">
          <h2 className="font-bold text-xl text-slate-800 flex items-center gap-2">
             {activeTab === 'settings' ? (
                <>
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                   Thông tin & Cài đặt
                </>
             ) : (
                <>
                   {activeTab === 'word' ? (
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                   ) : (
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                   )}
                   {isPreviewMode ? 'Xem trước kết quả (Chế độ đọc)' : `Kết quả ${activeTab === 'word' ? 'Word (HTML)' : 'LaTeX'} (Chỉnh sửa được)`}
                </>
             )}
          </h2>
          
          <div className="flex gap-2">
            {isLoading && (
                 <button 
                    onClick={handleStop}
                    className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm flex items-center gap-2 transition-all"
                 >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Dừng
                 </button>
            )}
            
            {(activeTab === 'word' || activeTab === 'latex') && resultContent && (
               <>
                 <button onClick={handleDownload} className="px-5 py-2.5 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm flex items-center gap-2 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    {activeTab === 'word' ? 'Tải xuống Word' : 'Tải xuống .Tex'}
                 </button>
                 
                 {/* OVERLEAF BUTTON (Only show in LaTeX Tab) */}
                 {activeTab === 'latex' && (
                     <button onClick={handleOpenOverleaf} className="px-5 py-2.5 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm flex items-center gap-2 transition-all">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                           <path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm0 2c5.514 0 10 4.486 10 10s-4.486 10-10 10-10-4.486-10-10 4.486-10 10-10zm-1.5 5l-4.5 9h3l1.5-3.5 1.5 3.5h3l-4.5-9h-3zm1.5 1.5l2 5h-4l2-5z"/>
                        </svg>
                        Chạy trên Overleaf
                     </button>
                 )}

                 <button onClick={handleCopy} className="px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm flex items-center gap-2 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    Sao chép
                 </button>
                 <button onClick={() => setIsPreviewMode(!isPreviewMode)} className={`px-5 py-2.5 text-sm font-bold text-white rounded-lg shadow-sm flex items-center gap-2 transition-all ${isPreviewMode ? 'bg-gray-600 hover:bg-gray-700' : 'bg-purple-600 hover:bg-purple-700'}`}>
                    {isPreviewMode ? (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                           Chỉnh sửa
                        </>
                    ) : (
                        <>
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                           Xem trước
                        </>
                    )}
                 </button>
               </>
            )}
          </div>
        </div>

        {/* Scrollable Document Container */}
        <div className="flex-1 overflow-y-auto p-0 custom-scrollbar flex justify-center bg-white">
           <style>{`
                .generated-content { font-family: 'Be Vietnam Pro', 'Times New Roman', serif; }
                .generated-content table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 16px; border: 2px solid #000; }
                .generated-content th { border: 1px solid #000; padding: 10px; background-color: #003366; color: #ffffff; text-align: center; font-weight: bold; }
                .generated-content td { border: 1px solid #000; padding: 10px; text-align: center; color: #000; font-weight: bold; background-color: #f8fafc; }
                /* Custom MathJax spacing fix */
                .generated-content mjx-container { display: inline-block !important; margin: 0 !important; }
              `}</style>

           {/* VIEW FOR SETTINGS */}
           {activeTab === 'settings' && (
              <div className="w-full h-full bg-slate-50 flex items-center justify-center animate-fade-in-up p-8">
                 <div className="bg-white max-w-2xl w-full rounded-2xl shadow-xl p-10 border border-blue-100 text-center">
                    <div className="w-24 h-24 bg-blue-600 text-white rounded-full flex items-center justify-center text-4xl font-bold mx-auto mb-6 shadow-lg">H</div>
                    <h2 className="text-3xl font-bold text-blue-900 mb-2">Nguyễn Đức Hiền</h2>
                    <p className="text-blue-500 font-semibold text-lg mb-6">Giáo viên Vật Lí</p>
                    <div className="h-1 w-24 bg-blue-100 mx-auto mb-6"></div>
                    <p className="text-gray-600 text-lg leading-relaxed mb-8">
                       Trường THCS và THPT Nguyễn Khuyến Bình Dương
                    </p>
                    <div className="bg-blue-50 rounded-xl p-6 border border-blue-100 text-sm text-blue-800">
                       <p className="font-semibold mb-2">Converter NK12</p>
                       <p>Công cụ chuyển đổi tài liệu thông minh sử dụng AI.</p>
                       <p className="mt-1">© 2025 Bản quyền thuộc về tác giả.</p>
                    </div>
                 </div>
              </div>
           )}

           {/* VIEW FOR CONVERSION RESULT (WORD OR LATEX) */}
           {(activeTab === 'word' || activeTab === 'latex') && (
              <div className="w-full h-full bg-white p-4 md:p-8 animate-fade-in-up">
                 
                 {/* 
                    MODE 1: EDIT MODE (ContentEditable) 
                 */}
                 {!isPreviewMode && (
                    <div 
                        ref={contentEditableRef}
                        contentEditable={true}
                        suppressContentEditableWarning={true}
                        onInput={handleContentChange}
                        onBlur={handleContentChange}
                        className={`generated-content prose prose-slate max-w-none w-full text-lg leading-relaxed text-gray-900 outline-none focus:ring-2 ring-blue-100 rounded-lg p-8 border border-gray-200 shadow-sm ${activeTab === 'latex' ? 'font-mono text-sm whitespace-pre-wrap' : ''}`}
                        style={{ minHeight: 'calc(100vh - 180px)' }}
                        dangerouslySetInnerHTML={{ __html: resultContent }}
                    >
                    </div>
                 )}

                 {/* 
                    MODE 2: PREVIEW MODE (Read-only + MathJax)
                    Renders HTML cleanly and triggers MathJax to format formulas.
                 */}
                 {isPreviewMode && (
                    <div 
                        className={`generated-content prose prose-slate max-w-none w-full text-lg leading-relaxed text-gray-900 p-8 border border-gray-100 ${activeTab === 'latex' ? 'font-mono text-sm whitespace-pre-wrap' : ''}`}
                        style={{ minHeight: 'calc(100vh - 180px)' }}
                        dangerouslySetInnerHTML={{ __html: resultContent }}
                    >
                    </div>
                 )}

                 {isLoading && (
                    <div className="mt-4 p-4 text-center text-blue-600 bg-blue-50 rounded-lg animate-pulse font-medium">
                       {loadingStatus || "Đang xử lý..."}
                    </div>
                 )}
                 {!resultContent && !isLoading && (
                    <div className="absolute top-[30%] left-0 w-full text-center pointer-events-none opacity-40">
                       <p className="text-xl text-slate-400 font-medium">Kết quả chuyển đổi sẽ hiển thị tại đây...</p>
                    </div>
                 )}
              </div>
           )}

        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);