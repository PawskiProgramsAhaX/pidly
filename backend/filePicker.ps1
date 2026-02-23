Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select PDF files"
$dialog.Filter = "PDF Files (*.pdf)|*.pdf"
$dialog.Multiselect = $true

if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    foreach ($f in $dialog.FileNames) {
        Write-Output $f
    }
}
