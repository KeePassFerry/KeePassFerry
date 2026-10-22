using System.Windows.Forms;

namespace KeePassFerry.Forms
{
    public partial class KeeMultiEntryUserControl : UserControl
    {
        public KeeMultiEntryUserControl()
        {
            InitializeComponent();
            label1.Text = FerryText.T(
                "Die KeePassFerry-Einstellungen der markierten Einträge unterscheiden sich. Um sie anzusehen oder zu ändern, bearbeite einen einzelnen Eintrag oder nur Einträge mit gleichen Einstellungen.",
                "The KeePassFerry settings of the selected entries differ. To view or change them, edit a single entry or only entries with identical settings.");
        }
    }
}
