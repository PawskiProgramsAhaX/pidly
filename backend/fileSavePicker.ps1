Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = "Save PDF As"
$dialog.Filter = "PDF Files (*.pdf)|*.pdf"
$dialog.DefaultExt = "pdf"

# Accept suggested filename from stdin args
if ($args.Length -gt 0) {
    $dialog.FileName = $args[0]
}

if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
}
