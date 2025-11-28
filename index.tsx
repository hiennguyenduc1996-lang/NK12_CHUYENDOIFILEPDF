import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";

const App = () => {
  // --- TABS STATE ---
  const [activeTab, setActiveTab] = useState<'home' | 'settings'>('home');

  // --- API KEY STATE ---
  const [userApiKey, setUserApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  // --- CONVERSION STATE ---
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>(""); // Store text if user pastes text
  const [fileName, setFileName] = useState<string>("");
  // Defaulting to 'word' mode internally as requested to remove the UI selector
  const conversionMode = 'word'; 
  
  // --- RESULT STATE ---
  const [resultContent, setResultContent] = useState<string>("");
  const contentEditableRef = useRef<HTMLDivElement>(null); 
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // --- INITIALIZATION ---
  useEffect(() => {
    const storedKey = localStorage.getItem("user_gemini_api_key");
    if (storedKey) setUserApiKey(storedKey);
  }, []);

  // Listen for paste events globally when on home tab to catch easy pastes
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (activeTab === 'home') {
        handlePaste(e);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [activeTab]);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setUserApiKey(newVal);
    localStorage.setItem("user_gemini_api_key", newVal);
  };

  const getApiKey = () => {
    return userApiKey.trim() || process.env.API_KEY || "";
  };

  // --- HELPER FUNCTIONS ---

  const createWordHtml = (content: string, title: string) => {
    return "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
      "xmlns:w='urn:schemas-microsoft-com:office:word' " +
      "xmlns='http://www.w3.org/TR/REC-html40'>" +
      "<head><meta charset='utf-8'><title>" + title + "</title>" +
      "<style>" + 
      "body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; } " + 
      "p { margin-bottom: 6pt; } " +
      "table { border-collapse: collapse; width: 100%; margin-top: 10px; border: 1px solid #000; } " +
      "td, th { border: 1px solid #000; padding: 5px; } " +
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

  // --- HANDLERS ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name);
      setPastedText(""); // Clear pasted text if file is chosen
      setError(null);
      setResultContent("");
    }
  };

  const handlePaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      // Handle Image Paste
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          setFile(blob);
          setFileName("Pasted_Image_" + new Date().getTime() + ".png");
          setPastedText("");
          setError(null);
          setResultContent("");
          // Prevent default paste behavior if it's an image
          e.preventDefault();
          return;
        }
      }
    }
    
    // Handle Text Paste (if no image found or intended)
    // We let normal text paste happen in textareas, but if we want to capture it as "input"
    // Here we check if the user is NOT focusing on an input field
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
        const text = e.clipboardData?.getData("text");
        if (text) {
             setPastedText(text);
             setFile(null);
             setFileName("");
             setError(null);
             setResultContent("");
        }
    }
  };

  const handleConvert = async () => {
    if (!file && !pastedText) return setError("Vui lòng tải file hoặc dán nội dung (Ctrl+V).");
    
    setIsLoading(true);
    setError(null);
    setResultContent("");
    setLoadingStatus("Đang phân tích dữ liệu...");

    try {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      const modelId = "gemini-2.5-flash"; 
      
      const parts: any[] = [];
      
      // Add File or Text
      if (file) {
          const filePart = await fileToGenericPart(file);
          parts.push(filePart);
      } else if (pastedText) {
          parts.push({ text: `Dưới đây là nội dung văn bản cần xử lý:\n${pastedText}` });
      }

      // Prompt
      const prompt = `
Bạn là một chuyên gia chuyển đổi tài liệu và soạn thảo văn bản.
Nhiệm vụ: Chuyển đổi nội dung đầu vào (hình ảnh, PDF, hoặc văn bản thô) thành mã HTML sạch, chuyên nghiệp để dán vào Microsoft Word.

YÊU CẦU:
1. **Giữ nguyên định dạng và nội dung**: Tiêu đề, đoạn văn, danh sách, bảng biểu (table).
2. **Công thức toán học**: Nếu có công thức toán, hãy cố gắng viết bằng ký tự Unicode hoặc dạng text dễ đọc nhất có thể (VD: x², H₂O).
3. **KHÔNG** dùng Markdown (không dùng \`\`\`). Chỉ xuất ra mã HTML thuần túy (thẻ p, h1, h2, table, b, i...).
4. Bỏ qua các chi tiết thừa như số trang ở góc, header/footer rác nếu là file scan.
5. Nếu đầu vào là văn bản thô, hãy định dạng lại cho đẹp (chia đoạn, in đậm tiêu đề).
`;

      parts.push({ text: prompt });

      setLoadingStatus("Đang chuyển đổi sang Word...");

      const response = await ai.models.generateContent({
        model: modelId,
        contents: { parts: parts },
        config: { temperature: 0.2 } 
      });

      let text = response.text || "";
      text = text.replace(/```html|```latex|```tex|```/g, "").trim();

      setResultContent(text);

    } catch (err: any) {
      setError("Lỗi chuyển đổi: " + err.message);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  const handleDownload = () => {
    let contentToSave = resultContent;
    if (contentEditableRef.current) {
        contentToSave = contentEditableRef.current.innerHTML;
    }
    
    if (!contentToSave) return;

    const sourceHTML = createWordHtml(contentToSave, "Converted Document");
    const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
    const link = document.createElement("a");
    link.href = source;
    link.download = `Converted_${fileName.split('.')[0] || 'Document'}.doc`;
    link.click();
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 overflow-hidden" onPaste={handlePaste}>
      
      {/* LEFT PANEL: Sidebar / Controls */}
      <div className="w-full md:w-[400px] flex-shrink-0 bg-blue-900 text-white flex flex-col h-full shadow-2xl z-20 relative">
        <div className="p-6 flex-grow overflow-y-auto custom-scrollbar flex flex-col">
          
          {/* Header */}
          <div className="mb-8 flex-shrink-0">
             <h1 className="text-xl font-bold tracking-tight text-white/90 uppercase leading-snug">
               CHUYỂN ĐỔI FILE PDF VÀ ẢNH SANG WORD
             </h1>
          </div>

          {/* SETTINGS VIEW BACK BUTTON */}
          {activeTab === 'settings' && (
              <button
                onClick={() => setActiveTab('home')}
                className="w-full mb-6 py-3 px-4 bg-blue-800 hover:bg-blue-700 text-white rounded-xl flex items-center gap-3 font-bold transition-all shadow-lg border border-blue-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Quay lại
              </button>
          )}

          {/* === CONTENT FOR HOME: CONVERTER === */}
          {activeTab === 'home' && (
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
                          <p className="text-xs text-green-200/70">File đã sẵn sàng</p>
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

                {/* Paste Area Helper (Visual only, actual paste is handled globally or via input) */}
                {!file && !pastedText && (
                    <div className="text-center">
                        <p className="text-[10px] text-blue-400 italic">Mẹo: Bạn có thể chụp màn hình và dán trực tiếp vào đây.</p>
                    </div>
                )}
              </div>
                
              {/* Action Button */}
              <div className="space-y-3 pt-6">
                    <button
                      onClick={handleConvert}
                      disabled={isLoading || (!file && !pastedText)}
                      className={`w-full py-3.5 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all 
                        ${isLoading || (!file && !pastedText) ? 'bg-blue-950 text-blue-500 cursor-not-allowed border border-blue-800' : 'bg-white hover:bg-blue-50 text-blue-900'}`}
                    >
                      {isLoading ? (
                        <>
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          <span className="text-sm">{loadingStatus}</span>
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          <span>Chuyển đổi ngay</span>
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
              onClick={() => setActiveTab('settings')}
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
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                   Kết quả chuyển đổi
                </>
             )}
          </h2>
          
          <div className="flex gap-2">
            {activeTab === 'home' && resultContent && (
               <button onClick={handleDownload} className="px-5 py-2.5 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm flex items-center gap-2 transition-all">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Tải xuống Word
               </button>
            )}
          </div>
        </div>

        {/* Scrollable Document Container */}
        <div className="flex-1 overflow-y-auto p-0 custom-scrollbar flex justify-center bg-white">
           <style>{`
                .generated-content { font-family: 'Be Vietnam Pro', 'Times New Roman', serif; }
                .generated-content table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 16px; border: 1px solid #000; }
                .generated-content th, .generated-content td { border: 1px solid #000; padding: 10px; }
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

           {/* VIEW FOR CONVERSION RESULT */}
           {activeTab === 'home' && (
              <div className="w-full h-full bg-white p-4 md:p-8 animate-fade-in-up">
                 {/* Conditionally render content editable div based on mode */}
                <div 
                    ref={contentEditableRef}
                    contentEditable={true}
                    suppressContentEditableWarning={true}
                    className={`generated-content prose prose-slate max-w-none w-full text-lg leading-relaxed text-gray-900 outline-none focus:ring-2 ring-blue-100 rounded-lg p-8 border border-gray-200 shadow-sm`}
                    style={{ minHeight: 'calc(100vh - 180px)' }}
                    dangerouslySetInnerHTML={{ __html: resultContent }}
                >
                </div>

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