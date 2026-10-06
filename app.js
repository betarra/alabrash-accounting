// ==========================================================================
// 1. إدارة التنقل وحفظ الحالات وتجهيز المتغيرات العامة
// ==========================================================================
let db;
const dbName = "VanSalesUltimateDB_V5";
const dbVersion = 1;
let localProducts = [];
let currentInvoiceItems = [];

function switchScreen(screenId) {
    const screens = document.querySelectorAll('.screen-section');
    screens.forEach(screen => screen.classList.add('hidden'));
    
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) targetScreen.classList.remove('hidden');
    
    const buttons = document.querySelectorAll('.nav-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    const activeBtn = Array.from(buttons).find(btn => btn.getAttribute('onclick').includes(screenId));
    if (activeBtn) activeBtn.classList.add('active');

    // تحديث البيانات تلقائياً فور النقر على أي تبويب
    if (screenId === 'inventory-screen') renderInventoryTable();
    if (screenId === 'reports-screen') renderLiveReports();
    if (screenId === 'debts-screen') renderDebtsDashboard();
    if (screenId === 'sales-screen') { loadProductsToPOS(); renderArchivedDaysTable(); }
}

// ==========================================================================
// 2. إعداد قاعدة البيانات المحلية المدمجة (IndexedDB) لتعمل أوفلاين
// ==========================================================================
const request = indexedDB.open(dbName, dbVersion);

request.onerror = function(event) {
    console.error("حدث خطأ في الذاكرة المحلية:", event.target.error);
};

request.onsuccess = function(event) {
    db = event.target.result;
    console.log("تم تفعيل قاعدة البيانات المحلية بنجاح.");
    loadProductsToPOS();
    renderArchivedDaysTable();
};

request.onupgradeneeded = function(event) {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains('invoices')) {
        db.createObjectStore('invoices', { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains('archived_days')) {
        db.createObjectStore('archived_days', { keyPath: 'id', autoIncrement: true });
    }
};

// ==========================================================================
// 3. حساب وتلقيم أسعار الربح التلقائي المئوي
// ==========================================================================
function calculateAutomaticFinalPrice() {
    const wholesaleCost = parseFloat(document.getElementById('new-prod-cost').value) || 0;
    const marginPercent = parseFloat(document.getElementById('new-prod-margin').value) || 0;
    const finalPrice = wholesaleCost + (wholesaleCost * (marginPercent / 100));
    document.getElementById('new-prod-final-price-display').textContent = finalPrice.toFixed(2);
    return finalPrice;
}
// ==========================================================================
// 4. حفظ الصنف بالسعر الصافي المضاف إليه نسبة الربح تلقائياً
// ==========================================================================
function saveProductToDB() {
    const name = document.getElementById('new-prod-name').value.trim();
    const unit = document.getElementById('new-prod-unit').value;
    const qty = parseFloat(document.getElementById('new-prod-qty').value);
    const wholesaleCost = parseFloat(document.getElementById('new-prod-cost').value);
    const marginPercent = parseFloat(document.getElementById('new-prod-margin').value) || 0;

    if (!name || isNaN(qty) || isNaN(wholesaleCost) || wholesaleCost <= 0) {
        alert("يرجى إدخال اسم الصنف وسعر الجملة الأصلي بشكل صحيح!");
        return;
    }

    const finalSellingPrice = wholesaleCost + (wholesaleCost * (marginPercent / 100));

    const productData = { 
        name: `${name} (${unit})`, 
        category: "ألبسة", 
        qty: qty, 
        cost: wholesaleCost, 
        retail_price: finalSellingPrice, 
        wholesale_price: finalSellingPrice 
    };

    const transaction = db.transaction(['products'], 'readwrite');
    const store = transaction.objectStore('products');
    
    store.add(productData).onsuccess = function() {
        alert(`🎉 تم حفظ الربح وإدراج الصنف [${name}] بسعر بيع نهائي: $${finalSellingPrice.toFixed(2)}`);
        document.getElementById('new-prod-name').value = '';
        document.getElementById('new-prod-cost').value = '';
        document.getElementById('new-prod-margin').value = '20';
        document.getElementById('new-prod-final-price-display').textContent = '0.00';
        loadProductsToPOS();
    };
}

// ==========================================================================
// 5. إدارة شاشة الكاشير واختيار المنتجات وتحديث الأسعار
// ==========================================================================
function loadProductsToPOS() {
    const transaction = db.transaction(['products'], 'readonly');
    const store = transaction.objectStore('products');
    
    store.getAll().onsuccess = function(event) {
        localProducts = event.target.result;
        const selectElement = document.getElementById('pos-product-select');
        selectElement.innerHTML = '<option value="">-- اختر مادة من القائمة --</option>';
        
        localProducts.forEach(product => {
            const option = document.createElement('option');
            option.value = product.id;
            option.textContent = product.name;
            selectElement.appendChild(option);
        });
    };
}

function handleProductSelection() {
    const productId = parseInt(document.getElementById('pos-product-select').value);
    const stockQtyDiv = document.getElementById('pos-stock-qty');
    const costHintDiv = document.getElementById('cost-hint');
    const priceInput = document.getElementById('pos-unit-price');

    if (!productId) {
        stockQtyDiv.textContent = '0';
        costHintDiv.textContent = '';
        priceInput.value = '';
        return;
    }

    const product = localProducts.find(p => p.id === productId);
    const saleType = document.getElementById('pos-sale-type').value;

    stockQtyDiv.textContent = product.qty;
    costHintDiv.textContent = ''; 

    const targetPrice = saleType === 'wholesale' ? product.wholesale_price : product.retail_price;
    priceInput.value = parseFloat(targetPrice).toFixed(2);
}

// ==========================================================================
// 6. إضافة المواد للسطر الحركي وحساب إجماليات الفاتورة الحية
// ==========================================================================
function addItemToInvoice() {
    const productSelect = document.getElementById('pos-product-select');
    const productId = parseInt(productSelect.value);
    const size = document.getElementById('pos-size').value;
    const qty = parseFloat(document.getElementById('pos-qty').value);
    const unitPrice = parseFloat(document.getElementById('pos-unit-price').value);

    if (!productId || isNaN(qty) || qty <= 0 || isNaN(unitPrice) || unitPrice < 0) {
        alert("تنبيه: يرجى اختيار صنف صحيح وتحديد السعر والكمية أولاً!");
        return;
    }

    const selectedProduct = localProducts.find(p => p.id === productId);

    if (qty > selectedProduct.qty) {
        alert(`خطأ: الكمية المطلوبة أكبر من المتاح بسيارتك حالياً! (المتاح بالجرد: ${selectedProduct.qty})`);
        return;
    }

    const total = unitPrice * qty;

    currentInvoiceItems.push({
        id: selectedProduct.id,
        name: selectedProduct.name,
        size: size,
        qty: qty,
        price: unitPrice,
        cost: selectedProduct.cost, 
        total: total
    });

    renderInvoiceTable();
    document.getElementById('pos-qty').value = 1;
}

function renderInvoiceTable() {
    const tbody = document.getElementById('invoice-items-body');
    tbody.innerHTML = '';
    let subtotal = 0;

    currentInvoiceItems.forEach((item, index) => {
        subtotal += item.total;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${item.name}</strong></td>
            <td>${item.size}</td>
            <td>${item.qty}</td>
            <td>$${item.price.toFixed(2)}</td>
            <td>$${item.total.toFixed(2)}</td>
            <td class="no-print"><button style="background:none; border:none; color:#ff5555; cursor:pointer; font-weight:bold;" onclick="removeItemFromInvoice(${index})">❌</button></td>
        `;
        tbody.appendChild(row);
    });

    recalcInvoiceTotals();
}

function removeItemFromInvoice(index) {
    currentInvoiceItems.splice(index, 1);
    renderInvoiceTable();
}

function recalcInvoiceTotals() {
    let subtotal = 0;
    currentInvoiceItems.forEach(item => subtotal += item.total);
    
    // 1. تحديث المجموع الكلي قبل الخصم
    document.getElementById('inv-subtotal').textContent = subtotal.toFixed(2);
    
    const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
    let net = subtotal - discount;
    if (net < 0) net = 0;

    // 2. تحديث الصافي النهائي بعد الخصم
    document.getElementById('inv-net').textContent = net.toFixed(2);
    
    calcRemainingBalance();
}


function calcRemainingBalance() {
    const net = parseFloat(document.getElementById('inv-net').textContent) || 0;
    const paid = parseFloat(document.getElementById('inv-paid').value) || 0;
    const remaining = net - paid;

    document.getElementById('inv-remaining').textContent = remaining >= 0 ? remaining.toFixed(2) : "0.00";
}
// ==========================================================================
// 7. حفظ الفاتورة وإنقاص المخزون مع توثيق اسم الزبون واليوم والتاريخ تلقائياً
// ==========================================================================
function saveInvoice() {
    if (currentInvoiceItems.length === 0) {
        alert("خطأ: الفاتورة فارغة، يرجى إضافة سلع أولاً!");
        return;
    }

    let subtotal = 0;
    currentInvoiceItems.forEach(item => subtotal += item.total);
    const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
    const net = subtotal - discount;
    const paid = parseFloat(document.getElementById('inv-paid').value) || 0;
    const remaining = net - paid;
    const customerName = document.getElementById('pos-customer-name').value.trim() || "زبون نقدي مفرق";

    // توثيق خيارات اليوم والتاريخ باللغة العربية بدقة
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const formattedDate = new Date().toLocaleDateString('ar-EG', dateOptions);

    const invoiceData = {
        date_text: formattedDate,
        customer_name: customerName,
        items: currentInvoiceItems,
        subtotal: subtotal,
        discount: discount,
        net_total: net,
        paid_amount: paid,
        remaining_debt: remaining > 0 ? remaining : 0,
        status: remaining > 0 ? "دين (آجل)" : "تم السداد بالكامل"
    };

    const transaction = db.transaction(['invoices', 'products'], 'readwrite');
    const invoiceStore = transaction.objectStore('invoices');
    const productStore = transaction.objectStore('products');

    invoiceStore.add(invoiceData);

    currentInvoiceItems.forEach(item => {
        const prod = localProducts.find(p => p.id === item.id);
        if (prod) {
            prod.qty = Math.max(0, prod.qty - item.qty);
            productStore.put(prod);
        }
    });

    transaction.oncomplete = function() {
        alert(`📥 تم إرسال الفاتورة للأرشيف وحفظها بنجاح!\nالزبون: ${customerName}\nالصافي: $${net.toFixed(2)}\nالدين المرحل للدفتر: $${invoiceData.remaining_debt.toFixed(2)}`);
        
        currentInvoiceItems = [];
        document.getElementById('pos-customer-name').value = '';
        document.getElementById('inv-discount').value = 0;
        document.getElementById('inv-paid').value = 0;
        renderInvoiceTable();
        loadProductsToPOS();
        document.getElementById('pos-stock-qty').textContent = '0';
    };
}

// ==========================================================================
// 8. طباعة الفاتورة الفورية للزبون
// ==========================================================================
function printThermalInvoice() {
    const customerName = document.getElementById('pos-customer-name').value.trim() || "السيد المحترم";
    const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
    
    document.getElementById('print-date').textContent = `التاريخ: ${new Date().toLocaleString('ar-EG')}`;
    document.getElementById('print-cust-name').textContent = `المشتري: ${customerName}`;
    
    // صياغة نص الخصم التلقائي الموجه باسم العميل في حال إدخال خصم
    const discountNote = document.getElementById('print-discount-note');
    if (discount > 0) {
        discountNote.style.display = 'block';
        discountNote.innerHTML = `📜 تم خصم مبلغ وقدره ($${discount.toFixed(2)}) للسيد/المحل [ ${customerName} ] إكراماً من الشركة.`;
    } else {
        discountNote.style.display = 'none';
    }

    window.print();
}


// ==========================================================================
// 9. تشغيل لوحة دفتر الديون وحساب الدين العام الإجمالي
// ==========================================================================
function renderDebtsDashboard() {
    const transaction = db.transaction(['invoices'], 'readonly');
    const store = transaction.objectStore('invoices');
    
    store.getAll().onsuccess = function(event) {
        const invoices = event.target.result;
        const tbody = document.getElementById('debts-summary-body');
        tbody.innerHTML = '';

        let globalDebtTotal = 0;
        const customerDebtMap = {};

        invoices.forEach(inv => {
            if (inv.remaining_debt > 0) {
                globalDebtTotal += inv.remaining_debt;
                customerDebtMap[inv.customer_name] = (customerDebtMap[inv.customer_name] || 0) + inv.remaining_debt;
            }
        });

        document.getElementById('global-debt-amount').textContent = `${globalDebtTotal.toFixed(2)} $`;

        const customerNames = Object.keys(customerDebtMap);
        if (customerNames.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">لا توجد أي ديون مستحقة في الدفتر حالياً.</td></tr>`;
            return;
        }

        customerNames.forEach(custName => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong style="color:var(--accent-blue); cursor:pointer;" onclick="viewCustomerDetailedLedger('${custName}')">👤 ${custName} (اضغط للتفاصيل)</strong></td>
                <td style="color: var(--warning-orange); font-weight: bold; font-size:1.1rem;">$${customerDebtMap[custName].toFixed(2)}</td>
                <td><button class="btn-gray-print" style="padding: 4px 10px; font-size:0.85rem; background-color:var(--success-green);" onclick="settleAllCustomerDebts('${custName}')">💵 تم السداد بالكامل</button></td>
            `;
            tbody.appendChild(row);
        });
    };
}
// ==========================================================================
// عرض جميع فواتير الزبون وتواريخها بدقة عند الضغط على اسمه
// ==========================================================================
// 1. عرض جميع فواتير وتواريخ الزبون مع تفعيل خيار الدفعات الجزئية
function viewCustomerDetailedLedger(customerName) {
    const transaction = db.transaction(['invoices'], 'readonly');
    const store = transaction.objectStore('invoices');
    
    store.getAll().onsuccess = function(event) {
        const invoices = event.target.result;
        const ledgerCard = document.getElementById('customer-ledger-card');
        const tbody = document.getElementById('customer-invoices-body');
        
        document.getElementById('ledger-customer-name').textContent = `كشف حساب وتواريخ فواتير الزبون: [ ${customerName} ]`;
        tbody.innerHTML = '';
        ledgerCard.classList.remove('hidden');

        // جلب الفواتير التي عليها دين فقط للزبون المحدد
        const customerInvoices = invoices.filter(inv => inv.customer_name === customerName && inv.remaining_debt > 0);

        customerInvoices.forEach(inv => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${inv.date_text}</td>
                <td style="color:var(--warning-orange); font-weight:600;">إجمالي الصافي: $${inv.net_total.toFixed(2)}</td>
                <td style="font-weight:bold; color:var(--primary-burgundy); font-size:1.05rem;">المتبقي للدين: $${inv.remaining_debt.toFixed(2)}</td>
                <td>
                    <button class="btn-gray-print" style="padding: 4px 8px; font-size:0.8rem; background-color:var(--accent-blue); margin-left:5px;" onclick="payPartialAmountOnInvoice(${inv.id})">👤 دفعة جزئية</button>
                    <button class="btn-gray-print" style="padding: 4px 8px; font-size:0.8rem; background-color:var(--success-green);" onclick="settleSingleInvoice(${inv.id})">تم السداد بالكامل ✅</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    };
}

// 2. دالة الدفعة الجزئية الجديدة والمطلوبة (إنقاص مبلغ محدد من الفاتورة)
function payPartialAmountOnInvoice(invoiceId) {
    const transaction = db.transaction(['invoices'], 'readwrite');
    const store = transaction.objectStore('invoices');
    
    store.get(invoiceId).onsuccess = function(event) {
        const invoice = event.target.result;
        if (invoice) {
            // نافذة منبثقة سريعة وعملية تسألك عن قيمة الدفعة الملموسة
            let paymentAmount = prompt(`الفاتورة متبقٍ عليها دين بقيمة ($${invoice.remaining_debt.toFixed(2)})\nكم المبلغ الذي سدده الزبون الآن؟`, "50");
            
            paymentAmount = parseFloat(paymentAmount);
            if (isNaN(paymentAmount) || paymentAmount <= 0) {
                alert("تنبيه: تم إلغاء العملية، يرجى كتابة مبلغ صحيح!");
                return;
            }

            if (paymentAmount > invoice.remaining_debt) {
                alert(`خطأ: المبلغ المدفوع ($${paymentAmount}) أكبر من قيمة الدين المتبقي الأصلي!`);
                return;
            }

            // الحساب الحركي التلقائي: إنقاص الدفعة الجزئية من الدين القديم
            invoice.remaining_debt = invoice.remaining_debt - paymentAmount;
            invoice.paid_amount = invoice.paid_amount + paymentAmount; // تحديث الإيراد النقدي للصندوق

            if (invoice.remaining_debt === 0) {
                invoice.status = "تم السداد بالكامل";
            } else {
                invoice.status = "دين (آجل) - مسدد جزئياً";
            }

            store.put(invoice);
            
            // عند اكتمال العملية بنجاح
            transaction.oncomplete = function() {
                alert(`🎉 تم خصم الدفعة بنجاح!\nالمبلغ المدفوع: $${paymentAmount.toFixed(2)}\nالمتبقي الجديد في ذمة العميل: $${invoice.remaining_debt.toFixed(2)}`);
                renderDebtsDashboard(); // تحديث لوحة الدين العام فوراً
                document.getElementById('customer-ledger-card').classList.add('hidden'); // إغلاق الكشف للتحديث
            };
        }
    };
}

// 3. تسديد الفاتورة بالكامل (لتصفير الحساب مباشرة دفعة واحدة)
function settleSingleInvoice(invoiceId) {
    const transaction = db.transaction(['invoices'], 'readwrite');
    const store = transaction.objectStore('invoices');
    
    store.get(invoiceId).onsuccess = function(event) {
        const invoice = event.target.result;
        if (invoice) {
            invoice.paid_amount = invoice.paid_amount + invoice.remaining_debt; // ترحيل المبلغ بالكامل لكاش الصندوق
            invoice.remaining_debt = 0;
            invoice.status = "تم السداد بالكامل";
            store.put(invoice);
        }
    };
    
    transaction.oncomplete = function() {
        alert("✅ تم تسديد الفاتورة بالكامل بنجاح وتحديث الحساب الميداني.");
        renderDebtsDashboard();
        document.getElementById('customer-ledger-card').classList.add('hidden');
    };
}

    
    transaction.oncomplete = function() {
        alert("✅ تم تسديد الفاتورة المحددة وتحديث الحساب الميداني.");
        renderDebtsDashboard();
        document.getElementById('customer-ledger-card').classList.add('hidden');
    };
// زر تسديد الحساب بالكامل وحذف اسم الزبون من قائمة الديون
function settleAllCustomerDebts(customerName) {
    const confirmSettle = confirm(`هل أنت متأكد من تسديد جميع ديون الزبون [ ${customerName} ] وإغلاق حسابه؟`);
    if (!confirmSettle) return;

    const transaction = db.transaction(['invoices'], 'readwrite');
    const store = transaction.objectStore('invoices');
    
    store.getAll().onsuccess = function(event) {
        const invoices = event.target.result;
        invoices.forEach(inv => {
            if (inv.customer_name === customerName && inv.remaining_debt > 0) {
                inv.remaining_debt = 0;
                inv.status = "تم السداد بالكامل";
                store.put(inv);
            }
        });
    };

    transaction.oncomplete = function() {
        alert(`🎉 تم تصفير وتسديد حساب العميل [ ${customerName} ] بنجاح من الدفتر!`);
        renderDebtsDashboard();
        document.getElementById('customer-ledger-card').classList.add('hidden');
    };
}

// ==========================================================================
// 10. جرد وأرباح الوردية الحالية والإغلاق
// ==========================================================================
// ==========================================================================
// 10. توليد جدول جرد المخزون الحالي بالسيارة مع زر الحذف المطور
// ==========================================================================
function renderInventoryTable() {
    const transaction = db.transaction(['products'], 'readonly');
    const store = transaction.objectStore('products');
    
    store.getAll().onsuccess = function(event) {
        const products = event.target.result;
        const tbody = document.getElementById('inventory-table-body');
        tbody.innerHTML = '';
        
        if (products.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">المستودع فارغ حالياً، قم بإضافة مواد.</td></tr>`;
            return;
        }

        products.forEach(p => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${p.name}</strong></td>
                <td>${p.category}</td>
                <td>$${p.cost.toFixed(2)}</td>
                <td>$${p.retail_price.toFixed(2)}</td>
                <td>$${p.wholesale_price.toFixed(2)}</td>
                <td style="font-weight:bold; color:var(--primary-burgundy);">${p.qty} قطعة</td>
                <!-- زر الحذف الحركي للصنف -->
                <td><button style="background:none; border:none; color:#ff5555; cursor:pointer; font-weight:bold; font-size:1.1rem;" onclick="deleteProductFromInventory(${p.id}, '${p.name}')">❌</button></td>
            `;
            tbody.appendChild(row);
        });
    };
}

// دالة الحذف الذكية والنهائية للصنف من قاعدة البيانات والمخزن
function deleteProductFromInventory(productId, productName) {
    const confirmDelete = confirm(`تنبيه: هل أنت متأكد من حذف صنف [ ${productName} ] نهائياً من مستودع السيارة؟`);
    if (!confirmDelete) return;

    const transaction = db.transaction(['products'], 'readwrite');
    const store = transaction.objectStore('products');
    
    store.delete(productId).onsuccess = function() {
        alert(`🗑️ تم حذف الصنف [ ${productName} ] وتحديث كميات الجرد بنجاح.`);
        renderInventoryTable(); // إعادة تحديث جدول الجرد فوراً
        loadProductsToPOS();    // إعادة تحديث قائمة اختيار المنتجات في شاشة الكاشير
    };
}

        products.forEach(p => {
            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${p.name}</strong></td><td>${p.category}</td><td>$${p.cost.toFixed(2)}</td><td>$${p.retail_price.toFixed(2)}</td><td>$${p.wholesale_price.toFixed(2)}</td><td style="font-weight:bold; color:var(--primary-burgundy);">${p.qty} قطعة</td>`;
            tbody.appendChild(row);
        });


function renderLiveReports() {
    let totalSales = 0; let totalCost = 0;
    const transaction = db.transaction(['invoices'], 'readonly');
    const store = transaction.objectStore('invoices');
    store.getAll().onsuccess = function(event) {
        const invoices = event.target.result;
        invoices.forEach(inv => {
            totalSales += inv.net_total;
            inv.items.forEach(item => { totalCost += (item.cost * item.qty); });
        });
        const netProfit = totalSales - totalCost;
        document.getElementById('rep-total-sales').textContent = `$${totalSales.toFixed(2)}`;
        document.getElementById('rep-net-profit').textContent = `$${netProfit.toFixed(2)}`;
    };
}

function closeAndArchiveDay() {
    const confirmClose = confirm("تنبيه: هل أنت متأكد من ترحيل وإغلاق يومية اليوم؟\nسيتم حفظ الأرباح دائمياً وتصفير فواتير الوردية الحالية.");
    if (!confirmClose) return;

    let totalSales = 0; let totalCost = 0;
    const transaction = db.transaction(['invoices'], 'readonly');
    transaction.objectStore('invoices').getAll().onsuccess = function(event) {
        const invoices = event.target.result;
        if (invoices.length === 0) { alert("خطأ: لا توجد فواتير اليوم لترحيلها!"); return; }
        invoices.forEach(inv => {
            totalSales += inv.net_total;
            inv.items.forEach(item => { totalCost += (item.cost * item.qty); });
        });
        const netProfit = totalSales - totalCost;
        const formattedDate = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const writeTx = db.transaction(['archived_days', 'invoices'], 'readwrite');
        writeTx.objectStore('archived_days').add({ date_text: formattedDate, total_sales: totalSales, net_profit: netProfit });
        writeTx.objectStore('invoices').clear();

        writeTx.oncomplete = function() {
            alert(`📥 تم ترحيل اليومية بنجاح لبدء وردية جديدة من الصفر!`);
            renderArchivedDaysTable();
        };
    };
}

function renderArchivedDaysTable() {
    const transaction = db.transaction(['archived_days'], 'readonly');
    transaction.objectStore('archived_days').getAll().onsuccess = function(event) {
        const archivedDays = event.target.result;
        const tbody = document.getElementById('archived-days-body');
        tbody.innerHTML = '';
        if (archivedDays.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">لا توجد أيام مؤرشفة سابقة حتى الآن.</td></tr>`;
            return;
        }
        archivedDays.reverse().forEach(day => {
            const row = document.createElement('tr');
            row.innerHTML = `<td><strong>${day.date_text}</strong></td><td>$${day.total_sales.toFixed(2)}</td><td style="color:var(--success-green); font-weight:bold;">$${day.net_profit.toFixed(2)}</td>`;
            tbody.appendChild(row);
        });
    };
}
